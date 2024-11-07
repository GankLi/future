import asyncio
import websockets
import wave
import io
import datetime
import os
import logging
import subprocess
import platform
import queue
import threading

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

# 确保audio目录存在
AUDIO_DIR = 'audio'
os.makedirs(AUDIO_DIR, exist_ok=True)

class AudioConverter:
    def __init__(self, output_file):
        self.output_file = output_file
        self.process = None
        self.is_running = False
        
    def start(self):
        """启动ffmpeg进程进行实时转换"""
        try:
            command = [
                'ffmpeg',
                '-f', 'webm',        # 输入格式
                '-i', 'pipe:0',      # 从stdin读取
                '-acodec', 'pcm_s16le',  # 16位PCM编码
                '-ar', '48000',      # 采样率
                '-ac', '2',          # 声道数
                '-f', 'wav',         # 输出格式
                self.output_file     # 输出文件
            ]
            
            self.process = subprocess.Popen(
                command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            self.is_running = True
            logging.info("音频转换进程已启动")
            
            # 启动错误监控线程
            def monitor_errors():
                for line in self.process.stderr:
                    if self.is_running:  # 只在运行时记录错误
                        logging.warning(f"FFmpeg: {line.decode().strip()}")
            
            error_thread = threading.Thread(target=monitor_errors)
            error_thread.daemon = True
            error_thread.start()
            
        except Exception as e:
            logging.error(f"启动转换进程失败: {str(e)}")
            self.is_running = False
            raise
    
    def write(self, data):
        """写入音频数据"""
        if self.is_running and self.process:
            try:
                self.process.stdin.write(data)
                self.process.stdin.flush()
            except Exception as e:
                logging.error(f"写入音频数据失败: {str(e)}")
                self.stop()
    
    def stop(self):
        """停止转换进程"""
        if self.is_running:
            try:
                if self.process and self.process.stdin:
                    self.process.stdin.close()
                if self.process:
                    self.process.wait(timeout=5)
            except Exception as e:
                logging.error(f"停止转换进程时发生错误: {str(e)}")
            finally:
                self.is_running = False
                self.process = None

async def handle_audio(websocket, path):
    client_id = id(websocket)
    logging.info(f'新的WebSocket连接建立 - 客户端ID: {client_id}')
    
    # 创建输出文件
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    output_file = os.path.join(AUDIO_DIR, f'audio_{timestamp}_{client_id}.wav')
    
    # 创建转换器
    converter = AudioConverter(output_file)
    
    try:
        # 启动转换器
        converter.start()
        logging.info(f'开始录制音频到: {output_file}')
        
        async for message in websocket:
            if isinstance(message, bytes):
                # 实时转换音频数据
                converter.write(message)
                logging.debug(f'处理音频数据: {len(message)} 字节')
                
    except websockets.exceptions.ConnectionClosed as e:
        logging.info(f'WebSocket连接关闭 - 客户端ID: {client_id}, 代码: {e.code}, 原因: {e.reason}')
    except Exception as e:
        logging.error(f'发生错误 - 客户端ID: {client_id}, 错误: {str(e)}')
    finally:
        # 停止转换器
        converter.stop()
        logging.info(f'音频录制已完成: {output_file}')
        
        # 验证输出文件
        if os.path.exists(output_file):
            try:
                probe_result = subprocess.run([
                    'ffprobe',
                    '-v', 'error',
                    '-select_streams', 'a:0',
                    '-show_entries', 'stream=codec_name,sample_rate,channels',
                    '-of', 'json',
                    output_file
                ], capture_output=True, text=True, check=True)
                logging.info(f'输出文件信息: {probe_result.stdout}')
            except Exception as e:
                logging.error(f'验证输出文件失败: {str(e)}')

async def main():
    server = await websockets.serve(handle_audio, "localhost", 8765)
    logging.info("WebSocket服务器已启动在 ws://localhost:8765")
    try:
        await server.wait_closed()
    except KeyboardInterrupt:
        logging.info("服务器正在关闭...")
        server.close()
        await server.wait_closed()
        logging.info("服务器已关闭")

if __name__ == "__main__":
    try:
        # 检查系统信息
        system_info = platform.system()
        processor = platform.processor()
        logging.info(f"系统信息: {system_info}, 处理器: {processor}")
        
        # 检查ffmpeg是否可用
        try:
            ffmpeg_version = subprocess.run(
                ['ffmpeg', '-version'], 
                capture_output=True, 
                text=True, 
                check=True
            )
            logging.info(f"FFmpeg版本信息: {ffmpeg_version.stdout.split('\\n')[0]}")
        except (subprocess.CalledProcessError, FileNotFoundError):
            logging.error("未找到ffmpeg，请先安装ffmpeg")
            exit(1)
            
        asyncio.run(main())
    except KeyboardInterrupt:
        logging.info("程序已终止")
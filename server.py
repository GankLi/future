import asyncio
import websockets
import wave
import io
import datetime
import os
import logging

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

# 检查audio目录
AUDIO_DIR = 'audio'
if not os.path.exists(AUDIO_DIR):
    try:
        os.makedirs(AUDIO_DIR)
        logging.info(f"已创建音频目录: {AUDIO_DIR}")
    except Exception as e:
        logging.error(f"创建音频目录时出错: {str(e)}")
        exit(1)

async def handle_audio(websocket, path):
    client_id = id(websocket)
    logging.info(f'新的WebSocket连接建立 - 客户端ID: {client_id}')
    
    # 创建WAV文件
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f'audio_{timestamp}.wav'
    filepath = os.path.join(AUDIO_DIR, filename)
    
    logging.info(f'开始录制音频，文件名: {filename}')
    wav_file = wave.open(filepath, 'wb')
    wav_file.setnchannels(2)  # 立体声
    wav_file.setsampwidth(2)  # 16位音频
    wav_file.setframerate(48000)  # 采样率
    
    try:
        async for message in websocket:
            # 将接收到的音频数据写入WAV文件
            if isinstance(message, bytes):
                wav_file.writeframes(message)
                logging.debug(f'接收到音频数据: {len(message)} 字节')
    except websockets.exceptions.ConnectionClosed as e:
        logging.info(f'WebSocket连接关闭 - 客户端ID: {client_id}, 代码: {e.code}, 原因: {e.reason}')
    except Exception as e:
        logging.error(f'发生错误 - 客户端ID: {client_id}, 错误: {str(e)}')
    finally:
        wav_file.close()
        logging.info(f'音频文件已保存: {filepath}')

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
        asyncio.run(main())
    except KeyboardInterrupt:
        logging.info("程序已终止")
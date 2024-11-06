let durationInterval;

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function updateUI(data) {
  const { state, stats } = data;
  const statusDisplay = document.getElementById('statusDisplay');
  const startButton = document.getElementById('startCapture');
  const stopButton = document.getElementById('stopCapture');
  
  // 更新状态显示
  if (state.isRecording) {
    statusDisplay.className = 'status recording';
    statusDisplay.textContent = '状态: 录制中';
    startButton.disabled = true;
    stopButton.disabled = false;
  } else {
    statusDisplay.className = 'status ready';
    statusDisplay.textContent = state.error ? `状态: 错误 (${state.error})` : '状态: 就绪';
    startButton.disabled = false;
    stopButton.disabled = true;
  }
  
  // 更新音频信息
  document.getElementById('duration').textContent = formatDuration(stats.duration);
  document.getElementById('format').textContent = stats.format || 'audio/webm';
  document.getElementById('sampleRate').textContent = `${stats.sampleRate} Hz`;
  document.getElementById('channels').textContent = stats.channels;
  document.getElementById('dataSize').textContent = formatBytes(stats.dataSize);
}

// 页面加载时获取当前状态
document.addEventListener('DOMContentLoaded', () => {
  chrome.runtime.sendMessage({action: 'getStatus'}, updateUI);
});

// 监听来自background的状态更新
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'statusUpdate') {
    updateUI(message.data);
  }
});

document.getElementById('startCapture').addEventListener('click', () => {
  chrome.runtime.sendMessage({action: 'startCapture'});
});

document.getElementById('stopCapture').addEventListener('click', () => {
  chrome.runtime.sendMessage({action: 'stopCapture'});
}); 
let mediaRecorder;
let ws;
let startTime;
let audioStream;
let durationTimer;

let recordingStats = {
  duration: 0,
  dataSize: 0,
  format: '',
  sampleRate: 0,
  channels: 0
};

let currentState = {
  isRecording: false,
  error: null
};

function updatePopup() {
  chrome.runtime.sendMessage({
    type: 'statusUpdate',
    data: {
      state: currentState,
      stats: recordingStats
    }
  });
}

function updateDuration() {
  if (startTime && currentState.isRecording) {
    recordingStats.duration = Math.floor((Date.now() - startTime) / 1000);
    updatePopup();
  }
}

function cleanupResources() {
  // 清理 WebSocket
  if (ws) {
    ws.close();
    ws = null;
  }

  // 清理 MediaRecorder
  if (mediaRecorder) {
    if (mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    mediaRecorder = null;
  }

  // 清理音频流
  if (audioStream) {
    audioStream.getTracks().forEach(track => {
      track.stop();
      track.enabled = false;
    });
    audioStream = null;
  }

  // 清理定时器
  if (durationTimer) {
    clearInterval(durationTimer);
    durationTimer = null;
  }

  // 重置状态
  startTime = null;
  currentState.isRecording = false;
  recordingStats = {
    duration: 0,
    dataSize: 0,
    format: '',
    sampleRate: 0,
    channels: 0
  };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startCapture') {
    // 确保在开始新的捕获前清理旧的资源
    cleanupResources();
    
    chrome.tabCapture.capture({
      audio: true,
      video: false
    }, (stream) => {
      if (stream) {
        try {
          audioStream = stream;
          ws = new WebSocket('ws://localhost:8765');
          
          ws.onopen = () => {
            mediaRecorder = new MediaRecorder(stream);
            startTime = Date.now();
            currentState.isRecording = true;
            currentState.error = null;
            
            const audioTrack = stream.getAudioTracks()[0];
            const settings = audioTrack.getSettings();
            recordingStats = {
              duration: 0,
              dataSize: 0,
              format: mediaRecorder.mimeType,
              sampleRate: settings.sampleRate || 48000,
              channels: 2
            };
            
            mediaRecorder.ondataavailable = (event) => {
              if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
                recordingStats.dataSize += event.data.size;
                ws.send(event.data);
                updatePopup();
              }
            };
            
            mediaRecorder.start(100);
            updatePopup();
            
            // 使用新的定时器变量
            durationTimer = setInterval(updateDuration, 1000);
          };
          
          ws.onerror = (error) => {
            currentState.error = "WebSocket连接失败";
            updatePopup();
            cleanupResources();
          };

          // 添加WebSocket关闭处理
          ws.onclose = () => {
            if (currentState.isRecording) {
              currentState.error = "WebSocket连接已关闭";
              updatePopup();
              cleanupResources();
            }
          };
          
        } catch (error) {
          currentState.error = error.message;
          updatePopup();
          cleanupResources();
        }
      } else {
        currentState.error = "无法获取音频流";
        updatePopup();
        cleanupResources();
      }
    });
  } else if (request.action === 'stopCapture') {
    cleanupResources();
    updatePopup();
  } else if (request.action === 'getStatus') {
    sendResponse({
      state: currentState,
      stats: recordingStats
    });
  }
});

// 添加清理监听器
chrome.runtime.onSuspend.addListener(() => {
  cleanupResources();
}); 
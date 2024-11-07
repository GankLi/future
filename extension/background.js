let recordingSessions = new Map(); // tabId -> SessionInfo

class SessionInfo {
  constructor(tabId, url) {
    this.tabId = tabId;
    this.url = normalizeUrl(url);
    this.mediaRecorder = null;
    this.ws = null;
    this.startTime = null;
    this.audioStream = null;
    this.durationTimer = null;
    this.connectionState = 'connecting';
    this.stats = {
      duration: 0,
      dataSize: 0,
      format: '',
      sampleRate: 0,
      channels: 0,
      pageInfo: {
        title: '',
        url: '',
        favicon: ''
      }
    };
  }

  cleanup() {
    console.log('开始清理会话资源');
    
    // 先停止 MediaRecorder
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch (error) {
        console.error('停止 MediaRecorder 失败:', error);
      }
      this.mediaRecorder = null;
    }

    // 关闭 WebSocket
    if (this.ws) {
      try {
        this.ws.close();
      } catch (error) {
        console.error('关闭 WebSocket 失败:', error);
      }
      this.ws = null;
    }

    // 停止音流
    if (this.audioStream) {
      try {
        this.audioStream.getTracks().forEach(track => {
          track.stop();
          track.enabled = false;
        });
      } catch (error) {
        console.error('停止音频流失败:', error);
      }
      this.audioStream = null;
    }

    // 清理定时器
    if (this.durationTimer) {
      clearInterval(this.durationTimer);
      this.durationTimer = null;
    }

    this.startTime = null;
    console.log('会话资源清理完成');
  }
}

// 当前状态
let currentState = {
  isRecording: false,
  error: null,
  recordingTabs: new Map(), // tabId -> { url, stats }
  pendingConnections: new Set()
};

function normalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname.includes('bilibili.com')) {
      const match = urlObj.pathname.match(/\/video\/(BV[\w]+)/);
      if (match) {
        return `https://www.bilibili.com/video/${match[1]}`;
      }
    }
    return `${urlObj.protocol}//${urlObj.hostname}${urlObj.pathname}`;
  } catch (e) {
    console.error('URL解析失败:', e);
    return url;
  }
}

// 添加节流函数
function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  }
}

// 首先定义 updatePopupWithTab 函数
function updatePopupWithTab(tabId, tab) {
  try {
    if (!tab) {
      console.warn('标签页不存在，跳过更新');
      return;
    }

    const normalizedUrl = normalizeUrl(tab.url);
    console.log('updatePopupWithTab - 当前URL:', {
      originalUrl: tab.url,
      normalizedUrl,
      recordingSessions: Array.from(recordingSessions.entries()),
      recordingTabs: Array.from(currentState.recordingTabs.entries())
    });

    const sessions = Array.from(currentState.recordingTabs.entries()).map(([id, data]) => ({
      tabId: parseInt(id),
      url: data.url,
      stats: data.stats
    }));

    const isCurrentUrlRecording = Array.from(currentState.recordingTabs.values())
      .some(data => normalizeUrl(data.url) === normalizedUrl);

    console.log('updatePopupWithTab - 状态检查:', {
      isCurrentUrlRecording,
      normalizedUrl,
      sessionUrls: Array.from(currentState.recordingTabs.values()).map(data => data.url)
    });

    chrome.runtime.sendMessage({
      type: 'statusUpdate',
      data: {
        state: {
          isRecording: isCurrentUrlRecording,
          error: currentState.error,
          tabId: tabId,
          url: normalizedUrl,
          recordingTabs: sessions,
          pendingConnections: Array.from(currentState.pendingConnections)
        },
        stats: currentState.recordingTabs.get(tabId)?.stats || {
          duration: 0,
          dataSize: 0,
          format: '',
          sampleRate: 0,
          channels: 0,
          pageInfo: { title: tab.title, url: tab.url, favicon: tab.favIconUrl }
        },
        sessions: sessions
      }
    });
  } catch (error) {
    console.error('更新Popup状态时出错:', error);
  }
}

// 然后定义 updatePopup 函数
function updatePopup(tabId) {
  // 如果没有提供tabId，获取当前活动标签页
  if (!tabId) {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (chrome.runtime.lastError) {
        console.warn('查询活动标签页失败:', chrome.runtime.lastError.message);
        return;
      }
      if (tabs && tabs.length > 0) {
        updatePopupWithTab(tabs[0].id, tabs[0]);
      } else {
        console.warn('未找到活动标签页');
      }
    });
    return;
  }

  // 使用提供的tabId获取标签页信息
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) {
      console.warn('标签页不存在:', chrome.runtime.lastError.message);
      return;
    }
    if (!tab) {
      console.warn('无法获取标签页信息');
      return;
    }
    updatePopupWithTab(tabId, tab);
  });
}

// 创建节流版本的updatePopup
const throttledUpdatePopup = throttle((tabId) => {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      return;
    }
    updatePopupWithTab(tabId, tab);
  });
}, 1000);

function updateDuration(tabId) {
  const session = recordingSessions.get(tabId);
  if (session && session.startTime) {
    session.stats.duration = Math.floor((Date.now() - session.startTime) / 1000);
    throttledUpdatePopup(tabId); // 使用节流版本的更新函数
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startCapture') {
    console.log('开始捕获请求:', {
      currentState,
      recordingSessions: Array.from(recordingSessions.entries())
    });
    
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      const currentTab = tabs[0];
      const tabId = currentTab.id;
      const normalizedUrl = normalizeUrl(currentTab.url);

      console.log('当前标签页信息:', {
        tabId,
        originalUrl: currentTab.url,
        normalizedUrl,
        title: currentTab.title
      });

      if (Array.from(recordingSessions.values()).some(s => s.url === normalizedUrl)) {
        currentState.error = "该页面已在录制中";
        updatePopup(tabId);
        return;
      }

      if (currentState.pendingConnections.has(normalizedUrl)) {
        currentState.error = "正在连接中...";
        updatePopup(tabId);
        return;
      }

      currentState.pendingConnections.add(normalizedUrl);
      currentState.error = "正在连接服务器...";
      updatePopup(tabId);

      const session = new SessionInfo(tabId, normalizedUrl);
      session.stats.pageInfo = {
        title: currentTab.title || '未知标题',
        url: currentTab.url || '未知URL',
        favicon: currentTab.favIconUrl || ''
      };

      chrome.tabCapture.capture({
        audio: true,
        video: false
      }, (stream) => {
        if (stream) {
          try {
            session.audioStream = stream;
            session.ws = new WebSocket('ws://localhost:8765');
            
            session.ws.onopen = () => {
              console.log('WebSocket连接成功');
              try {
                session.mediaRecorder = new MediaRecorder(stream);
                session.startTime = Date.now();
                
                const audioTrack = stream.getAudioTracks()[0];
                const settings = audioTrack.getSettings();
                session.stats.format = session.mediaRecorder.mimeType;
                session.stats.sampleRate = settings.sampleRate || 48000;
                session.stats.channels = 2;
                
                console.log('MediaRecorder初始化成功:', {
                  format: session.stats.format,
                  sampleRate: session.stats.sampleRate,
                  channels: session.stats.channels
                });
                
                session.mediaRecorder.ondataavailable = (event) => {
                  if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
                    console.log('WebSocket已关闭，停止录制');
                    session.cleanup();
                    recordingSessions.delete(tabId);
                    currentState.recordingTabs.delete(normalizedUrl);
                    currentState.error = "WebSocket连接已断开";
                    updatePopup(tabId);
                    return;
                  }

                  if (event.data.size > 0) {
                    try {
                      session.stats.dataSize += event.data.size;
                      session.ws.send(event.data);
                      currentState.recordingTabs.set(tabId, {
                        url: session.url,
                        stats: session.stats
                      });
                      throttledUpdatePopup(tabId);
                    } catch (error) {
                      console.error('发送音频数据失败:', error);
                      session.cleanup();
                      recordingSessions.delete(tabId);
                      currentState.recordingTabs.delete(normalizedUrl);
                      currentState.error = "发送音频数据失败";
                      updatePopup(tabId);
                    }
                  }
                };
                
                session.mediaRecorder.start(100);
                
                // 保存会话并更新状态
                recordingSessions.set(tabId, session);
                currentState.recordingTabs.set(tabId, {
                  url: session.url,
                  stats: session.stats
                });
                currentState.pendingConnections.delete(normalizedUrl);
                currentState.error = null;
                
                // 修改 SessionInfo 类中的定时器部分
                session.durationTimer = setInterval(() => {
                  if (session.startTime) {
                    // 更新会话状态
                    session.stats.duration = Math.floor((Date.now() - session.startTime) / 1000);
                    
                    // 更新 recordingTabs 中的统计信息
                    currentState.recordingTabs.set(tabId, {
                      url: session.url,
                      stats: {
                        ...session.stats,
                        duration: session.stats.duration,
                        dataSize: session.stats.dataSize
                      }
                    });

                    // 获取所有会话的最新状态
                    const sessions = Array.from(currentState.recordingTabs.entries()).map(([id, data]) => ({
                      tabId: id,
                      url: data.url,
                      stats: data.stats
                    }));

                    // 发送状态更新消息
                    chrome.runtime.sendMessage({
                      type: 'statusUpdate',
                      data: {
                        state: {
                          isRecording: true,
                          error: null,
                          tabId: tabId,
                          url: session.url,
                          recordingTabs: Array.from(currentState.recordingTabs.entries()).map(([id, data]) => ({
                            tabId: id,
                            url: data.url,
                            stats: data.stats
                          })),
                          pendingConnections: Array.from(currentState.pendingConnections)
                        },
                        stats: session.stats,
                        sessions: sessions
                      }
                    });

                    console.log('定时状态更新:', {
                      tabId,
                      duration: session.stats.duration,
                      dataSize: session.stats.dataSize,
                      sessions: sessions.map(s => ({
                        tabId: s.tabId,
                        duration: s.stats.duration,
                        dataSize: s.stats.dataSize
                      }))
                    });
                  }
                }, 1000);

                // 立即发送一次状态更新
                chrome.runtime.sendMessage({
                  type: 'statusUpdate',
                  data: {
                    state: {
                      isRecording: true,
                      error: null,
                      tabId: tabId,
                      url: normalizedUrl,
                      recordingTabs: Array.from(currentState.recordingTabs.entries()).map(([id, data]) => ({
                        tabId: id,
                        url: data.url,
                        stats: data.stats
                      })),
                      pendingConnections: Array.from(currentState.pendingConnections)
                    },
                    stats: session.stats,
                    sessions: [{
                      tabId,
                      url: normalizedUrl,
                      stats: session.stats
                    }]
                  }
                });

                console.log('录制开始，当前状态:', {
                  recordingSessions: Array.from(recordingSessions.entries()),
                  recordingTabs: Array.from(currentState.recordingTabs.entries()),
                  pendingConnections: Array.from(currentState.pendingConnections),
                  currentUrl: normalizedUrl,
                  isRecording: true
                });
              } catch (error) {
                console.error('录制初始化失败:', error);
                currentState.error = `录制初始化失败: ${error.message}`;
                session.cleanup();
                currentState.pendingConnections.delete(normalizedUrl);
                updatePopup(tabId);
              }
            };
            
            session.ws.onconnecting = () => {
              currentState.error = "正在连接服务器...";
              updatePopup(tabId);
            };
            
            session.ws.onerror = (error) => {
              console.error('WebSocket错误:', error);
              currentState.pendingConnections.delete(normalizedUrl);
              currentState.error = "WebSocket连接失败";
              session.cleanup();
              updatePopup(tabId);
            };

            session.ws.onclose = () => {
              console.log('WebSocket连接关闭');
              currentState.pendingConnections.delete(normalizedUrl);
              if (recordingSessions.has(tabId)) {
                currentState.error = "WebSocket连接已关闭";
                // 确保在清理前停止 MediaRecorder
                if (session.mediaRecorder && session.mediaRecorder.state !== 'inactive') {
                  try {
                    session.mediaRecorder.stop();
                  } catch (error) {
                    console.error('停止 MediaRecorder 失败:', error);
                  }
                }
                session.cleanup();
                recordingSessions.delete(tabId);
                currentState.recordingTabs.delete(normalizedUrl);
                updatePopup(tabId);
              }
            };
            
          } catch (error) {
            currentState.error = `录制初始化失败: ${error.message}`;
            session.cleanup();
            updatePopup(tabId);
          }
        } else {
          currentState.error = "无法获取音频流";
          updatePopup(tabId);
        }
      });
    });
  } else if (request.action === 'stopCapture') {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      const tabId = tabs[0].id;
      const session = recordingSessions.get(tabId);
      if (session) {
        session.cleanup();
        recordingSessions.delete(tabId);
        currentState.recordingTabs.delete(session.url);
        currentState.error = null;
        updatePopup(tabId);
      }
    });
  } else if (request.action === 'getStatus') {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      const tabId = tabs[0].id;
      const session = recordingSessions.get(tabId);
      sendResponse({
        state: {
          isRecording: !!session,
          error: currentState.error,
          tabId: tabId,
          recordingTabs: currentState.recordingTabs
        },
        stats: session ? session.stats : {
          duration: 0,
          dataSize: 0,
          format: '',
          sampleRate: 0,
          channels: 0,
          pageInfo: { title: '', url: '', favicon: '' }
        }
      });
    });
    return true;
  } else if (request.action === 'getAllSessions') {
    try {
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        // 检查tabs是否存在且有值
        if (!tabs || tabs.length === 0) {
          // 返回一个基本的响应，但包含现有的会话信息
          const sessions = Array.from(currentState.recordingTabs.entries()).map(([tabId, data]) => ({
            tabId,
            url: data.url,
            stats: data.stats
          }));
          
          // 确保sendResponse存在且是函数
          if (typeof sendResponse === 'function') {
            sendResponse({
              sessions,
              state: {
                isRecording: false,
                error: null,
                tabId: null,
                url: null,
                recordingTabs: Array.from(currentState.recordingTabs.entries()).map(([id, data]) => ({
                  tabId: id,
                  url: data.url,
                  stats: data.stats
                })),
                pendingConnections: Array.from(currentState.pendingConnections)
              },
              stats: {
                duration: 0,
                dataSize: 0,
                format: '',
                sampleRate: 0,
                channels: 0,
                pageInfo: { title: '', url: '', favicon: '' }
              }
            });
          }
          return;
        }

        const currentTabId = tabs[0].id;
        const currentUrl = normalizeUrl(tabs[0].url);
        const sessions = Array.from(currentState.recordingTabs.entries()).map(([tabId, data]) => ({
          tabId,
          url: data.url,
          stats: data.stats
        }));
        
        // 检查当前URL是否正在录制
        const isCurrentUrlRecording = Array.from(currentState.recordingTabs.values())
          .some(session => session.url === currentUrl);
        
        // 检查当前URL是否正在连接中
        const isCurrentUrlPending = currentState.pendingConnections.has(currentUrl);
        
        // 确保sendResponse存在且是函数
        if (typeof sendResponse === 'function') {
          sendResponse({
            sessions,
            state: {
              isRecording: isCurrentUrlRecording,
              error: currentState.error,
              tabId: currentTabId,
              url: currentUrl,
              recordingTabs: Array.from(currentState.recordingTabs.entries()).map(([id, data]) => ({
                tabId: id,
                url: data.url,
                stats: data.stats
              })),
              pendingConnections: Array.from(currentState.pendingConnections)
            },
            stats: currentState.recordingTabs.get(currentTabId)?.stats || {
              duration: 0,
              dataSize: 0,
              format: '',
              sampleRate: 0,
              channels: 0,
              pageInfo: { title: '', url: '', favicon: '' }
            }
          });
        }
      });
    } catch (error) {
      console.error('获取会话信息时出错:', error);
      // 确保sendResponse存在且是函数
      if (typeof sendResponse === 'function') {
        sendResponse({
          sessions: [],
          state: {
            isRecording: false,
            error: "获取标签页信息失败",
            tabId: null,
            url: null,
            recordingTabs: Array.from(currentState.recordingTabs.entries()).map(([id, data]) => ({
              tabId: id,
              url: data.url,
              stats: data.stats
            })),
            pendingConnections: Array.from(currentState.pendingConnections)
          },
          stats: {
            duration: 0,
            dataSize: 0,
            format: '',
            sampleRate: 0,
            channels: 0,
            pageInfo: { title: '', url: '', favicon: '' }
          }
        });
      }
    }
    return true;
  } else if (request.action === 'stopAllCapture') {
    for (let [tabId, session] of recordingSessions) {
      session.cleanup();
      recordingSessions.delete(tabId);
      currentState.recordingTabs.delete(session.url);
      updatePopup(tabId);
    }
    currentState.error = null;
    
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs[0]) {
        updatePopup(tabs[0].id);
      }
    });
  }
});

// 清理监听器
chrome.runtime.onSuspend.addListener(() => {
  for (let [tabId, session] of recordingSessions) {
    session.cleanup();
  }
  recordingSessions.clear();
  currentState.recordingTabs.clear();
});

// 标签页关闭时清理相关录制会话
chrome.tabs.onRemoved.addListener((tabId) => {
  const session = recordingSessions.get(tabId);
  if (session) {
    session.cleanup();
    recordingSessions.delete(tabId);
    currentState.recordingTabs.delete(session.url);
  }
});

// 添加标签页激活事件监听
chrome.tabs.onActivated.addListener((activeInfo) => {
  updatePopup(activeInfo.tabId);
});
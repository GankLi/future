let durationInterval;
let lastSessionsData = null; // 用于缓存会话数据，减少闪烁
let lastStatusData = null;   // 用于缓存状态数据，减少闪烁

// 添加一个全局变量来跟踪DOM是否已加载
let domLoaded = false;

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

function updateSessionsList(sessions) {
  // 检查DOM是否已加载
  if (!domLoaded) {
    console.debug('DOM未加载，跳过会话列表更新');
    return;
  }

  console.log('更新会话列表:', {
    sessionsCount: sessions.length,
    sessions: sessions.map(s => ({
      tabId: s.tabId,
      title: s.stats.pageInfo.title,
      duration: s.stats.duration,
      dataSize: s.stats.dataSize
    }))
  });
  
  // 获取DOM元素
  const sessionsContainer = document.getElementById('recordingSessions');
  const noSessionsElement = document.getElementById('noSessions');
  const sessionsCount = document.getElementById('sessionsCount');
  
  if (!sessionsContainer || !noSessionsElement || !sessionsCount) {
    console.debug('找不到必要的DOM元素，可能popup已关闭');
    return;
  }
  
  // 总是更新会话计数
  sessionsCount.textContent = sessions ? sessions.length : 0;
  
  try {
    // 总是清空容器
    sessionsContainer.innerHTML = '';
    
    // 添加无会话提示
    const noSessionsDiv = document.createElement('div');
    noSessionsDiv.id = 'noSessions';
    noSessionsDiv.className = 'no-sessions';
    noSessionsDiv.textContent = '暂无录制会话';
    sessionsContainer.appendChild(noSessionsDiv);

    // 如果有会话，则隐藏无会话提示并添加会话列表
    if (sessions && sessions.length > 0) {
      noSessionsDiv.style.display = 'none';
      
      // 构建新的会话列表HTML
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (!tabs || !tabs[0]) {
          console.warn('无法获取当前标签页');
          return;
        }

        const currentTabId = tabs[0].id;
        
        // 为每个会话创建HTML
        sessions.forEach(session => {
          const isCurrentTab = session.tabId === currentTabId;
          
          const sessionDiv = document.createElement('div');
          sessionDiv.className = `recording-session ${isCurrentTab ? 'current-tab' : ''}`;
          sessionDiv.setAttribute('data-tab-id', session.tabId);
          
          sessionDiv.innerHTML = `
            <div class="session-header">
              <div class="session-title">
                <img src="${session.stats.pageInfo.favicon || 'default-favicon.png'}" alt="">
                <span>${session.stats.pageInfo.title || '未知标题'}</span>
              </div>
              <div class="session-duration">${formatDuration(session.stats.duration || 0)}</div>
            </div>
            <div class="session-info">
              <div>数据大小: ${formatBytes(session.stats.dataSize || 0)}</div>
            </div>
          `;
          
          sessionsContainer.appendChild(sessionDiv);
        });
      });
    } else {
      // 显示无会话提示
      noSessionsDiv.style.display = 'block';
    }
  } catch (error) {
    console.error('更新会话列表失败:', error);
    // 发生错误时重置为无会话状态
    sessionsContainer.innerHTML = `
      <div id="noSessions" class="no-sessions">
        暂无录制会话
      </div>
    `;
    sessionsCount.textContent = '0';
  }
}

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

function updateStatusDisplay(state, currentTabId) {
  // 检查DOM是否已加载
  if (!domLoaded) {
    console.debug('DOM未加载，跳过状态显示更新');
    return;
  }

  console.log('更新状态显示 - 输入:', {
    state,
    currentTabId,
    recordingTabs: state.recordingTabs || [],
    pendingConnections: state.pendingConnections || []
  });
  
  const statusDisplay = document.getElementById('statusDisplay');
  const startButton = document.getElementById('startCapture');
  const stopButton = document.getElementById('stopCapture');
  const stopAllButton = document.getElementById('stopAllCapture');
  
  // 修改状态判断逻辑，确保与background.js一致
  const normalizedCurrentUrl = state.url ? normalizeUrl(state.url) : null;
  
  // 使用正确的数据结构进行判断
  const isCurrentUrlRecording = normalizedCurrentUrl && 
    (state.recordingTabs || []).some(tab => normalizeUrl(tab.url) === normalizedCurrentUrl);
      
  const isPending = normalizedCurrentUrl && 
    (state.pendingConnections || []).includes(normalizedCurrentUrl);
      
  // 使用正确的数组长度判断
  const hasAnyRecording = state.recordingTabs && state.recordingTabs.length > 0;

  console.log('状态判断结果:', {
    normalizedCurrentUrl,
    isCurrentUrlRecording,
    isPending,
    hasAnyRecording,
    recordingTabs: state.recordingTabs || [],
    pendingConnections: state.pendingConnections || []
  });

  // 设置状态和按钮
  let statusText = '';
  let statusClass = '';
  
  if (state.error) {
    statusText = `状态: ${state.error}`;
    statusClass = 'ready';
    startButton.disabled = isPending;
    stopButton.disabled = true;
  } else if (isPending) {
    statusText = '状态: 正在连接...';
    statusClass = 'connecting';
    startButton.disabled = true;
    stopButton.disabled = true;
  } else if (isCurrentUrlRecording) {
    statusText = '状态: 录制中';
    statusClass = 'recording';
    startButton.disabled = true;
    stopButton.disabled = false;
  } else {
    statusText = '状态: 就绪';
    statusClass = 'ready';
    startButton.disabled = false;
    stopButton.disabled = true;
  }

  // 更新状态显示
  statusDisplay.className = `status ${statusClass}`;
  if (statusClass === 'recording') {
    statusDisplay.innerHTML = '<span id="recordingDot" class="recording-indicator"></span>' + statusText;
  } else {
    statusDisplay.textContent = statusText;
  }
  
  stopAllButton.disabled = !hasAnyRecording;

  console.log('按钮状态更新:', {
    statusText,
    statusClass,
    startButtonDisabled: startButton.disabled,
    stopButtonDisabled: stopButton.disabled,
    stopAllButtonDisabled: stopAllButton.disabled
  });
}

function updateUI(data) {
  if (!data) return;
  
  const { state, stats, sessions } = data;
  
  // 获取当前标签页ID并更新UI
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    if (!tabs || !tabs[0]) return;
    
    const currentTabId = tabs[0].id;
    const currentUrl = tabs[0].url;
    
    console.log('更新UI:', {
      currentTabId,
      currentUrl,
      sessions: sessions?.map(s => ({
        tabId: s.tabId,
        url: s.url,
        stats: s.stats
      })),
      recordingTabs: state.recordingTabs
    });
    
    // 更新状态对象以包含当前URL
    const updatedState = {
      ...state,
      url: currentUrl
    };
    
    // 更新状态显示
    updateStatusDisplay(updatedState, currentTabId);
    
    // 更新会话列表
    if (sessions && sessions.length > 0) {
      console.log('更新会话列表:', sessions);
      updateSessionsList(sessions);
    }
  });
}

// 添加一个函数来检查DOM元素是否都存在
function checkDOMElements() {
  const requiredElements = [
    'recordingSessions',
    'noSessions',
    'sessionsCount',
    'statusDisplay',
    'startCapture',
    'stopCapture',
    'stopAllCapture'
  ];
  
  const missingElements = requiredElements.filter(id => !document.getElementById(id));
  if (missingElements.length > 0) {
    console.debug('缺少DOM元素:', missingElements);
    return false;
  }
  return true;
}

// 修改轮询函数
function pollStatus() {
  // 检查DOM元素是否存在
  if (!checkDOMElements()) {
    console.debug('DOM元素不完整，跳过轮询');
    return;
  }

  chrome.runtime.sendMessage({action: 'getAllSessions'}, (response) => {
    if (!checkDOMElements()) {
      console.debug('DOM元素不完整，跳过更新');
      return;
    }

    if (chrome.runtime.lastError) {
      console.warn('获取状态失败:', chrome.runtime.lastError);
      return;
    }
    
    if (response) {
      // 获取当前标签页ID并更新UI
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (!checkDOMElements()) {
          console.debug('DOM元素不完整，跳过标签页更新');
          return;
        }

        if (!tabs || !tabs[0]) return;
        
        const currentTabId = tabs[0].id;
        const currentUrl = tabs[0].url;
        
        // 更新状态对象以包含当前URL
        const updatedState = {
          ...response.state,
          url: currentUrl
        };
        
        // 更新状态显示
        updateStatusDisplay(updatedState, currentTabId);
        
        // 更新会话列表
        if (response.sessions && response.sessions.length > 0) {
          updateSessionsList(response.sessions);
        }
      });
    }
  });
}

// 修改页面加载事件处理
document.addEventListener('DOMContentLoaded', () => {
  console.log('Popup页面加载完成');
  
  // 等待一小段时间确保DOM完全加载
  setTimeout(() => {
    if (!checkDOMElements()) {
      console.error('无法找到必要的DOM元素');
      return;
    }
    
    console.log('所有必要的DOM元素已找到');
    domLoaded = true;
    
    // 立即获取一次状态
    pollStatus();
    
    // 开始轮询
    pollInterval = setInterval(() => {
      if (!checkDOMElements()) {
        console.log('Popup已关闭，停止轮询');
        clearInterval(pollInterval);
        pollInterval = null;
        domLoaded = false;
        return;
      }
      pollStatus();
    }, 500);
  }, 100);
});

// 当popup关闭时清理
window.addEventListener('unload', () => {
  console.log('Popup页面关闭');
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
});

// 改按钮点击处理
document.getElementById('startCapture').addEventListener('click', () => {
  console.log('点击开始捕获按钮');
  
  // 点击后立即更新状态为"连接"
  const statusDisplay = document.getElementById('statusDisplay');
  statusDisplay.className = 'status connecting';
  statusDisplay.textContent = '状态: 正在连接...';
  document.getElementById('startCapture').disabled = true;
  
  chrome.runtime.sendMessage({action: 'startCapture'});
  
  // 立即获取一次状态
  setTimeout(() => {
    chrome.runtime.sendMessage({action: 'getAllSessions'}, updateUI);
  }, 100);
});

document.getElementById('stopCapture').addEventListener('click', () => {
  console.log('点击停止捕获按钮');
  chrome.runtime.sendMessage({action: 'stopCapture'});
  
  // 立即获取一次状态
  setTimeout(() => {
    chrome.runtime.sendMessage({action: 'getAllSessions'}, updateUI);
  }, 100);
});

document.getElementById('stopAllCapture').addEventListener('click', () => {
  chrome.runtime.sendMessage({action: 'stopAllCapture'});
  
  // 立即获取一次状态
  setTimeout(() => {
    chrome.runtime.sendMessage({action: 'getAllSessions'}, updateUI);
  }, 100);
}); 
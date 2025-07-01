const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fetch = require('node-fetch');

let mainWindow;
let pythonProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1e1e2e',
      symbolColor: '#cdd6f4'
    },
    show: false,
    backgroundColor: '#1e1e2e'
  });

  mainWindow.loadFile('renderer/index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (pythonProcess) {
      pythonProcess.kill();
    }
  });
}

// Python バックエンドを起動
function startPythonBackend() {
  pythonProcess = spawn('python', ['backend/api.py'], {
    cwd: __dirname
  });

  pythonProcess.stdout.on('data', (data) => {
    console.log(`Python stdout: ${data}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`Python stderr: ${data}`);
  });
}

// APIサーバーの起動を待つ
async function waitForAPI() {
  const maxRetries = 30;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch('http://127.0.0.1:5000/api/health');
      if (response.ok) {
        console.log('Python API サーバーが利用可能です');
        return true;
      }
    } catch (error) {
      // 接続エラーは無視
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  console.error('Python API サーバーの起動に失敗しました');
  return false;
}

app.whenReady().then(async () => {
  createWindow();
  startPythonBackend();
  
  // APIサーバーの起動を待つ
  console.log('Python APIサーバーの起動を待機中...');
  const apiReady = await waitForAPI();
  
  if (apiReady) {
    console.log('アプリケーションの初期化が完了しました');
    // フロントエンドに初期化完了を通知（オプション）
  } else {
    console.error('Python APIサーバーの起動に失敗しました');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers
ipcMain.handle('get-tasks', async () => {
  try {
    const response = await fetch('http://127.0.0.1:5000/api/tasks');
    const data = await response.json();
    return data.success ? data.tasks : [];
  } catch (error) {
    console.error('タスク取得エラー:', error);
    return [];
  }
});

ipcMain.handle('add-task', async (event, taskName, isBreak = false) => {
  try {
    const response = await fetch('http://127.0.0.1:5000/api/tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: taskName, isBreak })
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('タスク追加エラー:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('end-task', async () => {
  try {
    const response = await fetch('http://127.0.0.1:5000/api/tasks/end', {
      method: 'POST'
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('タスク終了エラー:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('copy-timeline', async () => {
  try {
    const response = await fetch('http://127.0.0.1:5000/api/timeline/copy', {
      method: 'POST'
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('タイムラインコピーエラー:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('clear-all-tasks', async () => {
  try {
    const response = await fetch('http://127.0.0.1:5000/api/tasks/clear', {
      method: 'POST'
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('タスククリアエラー:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update-task', async (event, taskId, taskData) => {
  try {
    const response = await fetch(`http://127.0.0.1:5000/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(taskData)
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('タスク更新エラー:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-task', async (event, taskId) => {
  try {
    console.log('削除リクエスト - タスクID:', taskId);
    
    if (taskId === null || taskId === undefined) {
      return { success: false, error: 'タスクIDが無効です' };
    }
    
    const response = await fetch(`http://127.0.0.1:5000/api/tasks/${taskId}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('HTTP エラー:', response.status, errorText);
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('タスク削除エラー:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('health-check', async () => {
  try {
    const response = await fetch('http://127.0.0.1:5000/api/health');
    if (response.ok) {
      const data = await response.json();
      return { success: true, data };
    } else {
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-report', async () => {
  try {
    const response = await fetch('http://127.0.0.1:5000/api/report');
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('報告書取得エラー:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-report', async (event, content) => {
  try {
    const response = await fetch('http://127.0.0.1:5000/api/report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content })
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('報告書保存エラー:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-report-urls', async () => {
  try {
    const response = await fetch('http://127.0.0.1:5000/api/report-urls');
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('報告先URL取得エラー:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('add-report-url', async (event, name, url) => {
  try {
    const response = await fetch('http://127.0.0.1:5000/api/report-urls', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, url })
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('報告先URL追加エラー:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-report-url', async (event, urlId) => {
  try {
    const response = await fetch(`http://127.0.0.1:5000/api/report-urls/${urlId}`, {
      method: 'DELETE'
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('報告先URL削除エラー:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-external-url', async (event, url) => {
  try {
    const { shell } = require('electron');
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    console.error('外部URL開きエラー:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-report-tabs', async () => {
  try {
    const response = await fetch('http://127.0.0.1:5000/api/report-tabs');
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('報告タブ取得エラー:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-report-tab-content', async (event, tabId) => {
  try {
    const response = await fetch(`http://127.0.0.1:5000/api/report-tabs/${tabId}`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('報告タブ内容取得エラー:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-report-tab-content', async (event, tabId, content) => {
  try {
    const response = await fetch(`http://127.0.0.1:5000/api/report-tabs/${tabId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content })
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('報告タブ内容保存エラー:', error);
    return { success: false, error: error.message };
  }
});
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, Tray, globalShortcut } = require('electron');
const path = require('path');
const { TaskManager, createApp } = require('./backend/task-manager');
const fs = require('fs'); // fsモジュールをグローバルにインポート

let mainWindow;
let taskManager;
let tray;
let settings = {};
let registeredHotkeys = [];

// デバッグログファイルのパスをグローバルに定義
let debugLogPath;

// 元のconsoleメソッドを保存
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

// デバッグログをファイルに書き込む関数
function writeDebugLog(message) {
  // パッケージ版では常にログを書き込まない
  if (app.isPackaged) {
    return;
  }
  // 開発モードでのみログを書き込む
  if (!debugLogPath) {
    debugLogPath = path.join(app.getPath('userData'), 'debug.log');
  }
  try {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(debugLogPath, `[${timestamp}] ${message}\n`);
  } catch (error) {
    if (originalConsoleError) {
      originalConsoleError('Failed to write debug log:', error);
    }
  }
}

// console.logとconsole.errorをオーバーライド
// パッケージ化されているかどうかにかかわらず、writeDebugLogを呼び出す
// writeDebugLog内でapp.isPackagedのチェックを行う
console.log = (...args) => {
  // オブジェクトをJSON文字列に変換してログに含める
  const formattedArgs = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg);
  writeDebugLog(`[INFO] ${formattedArgs.join(' ')}`);
  originalConsoleLog.apply(console, args); // 元のconsole.logも呼び出す
};

console.error = (...args) => {
  const formattedArgs = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg);
  writeDebugLog(`[ERROR] ${formattedArgs.join(' ')}`);
  originalConsoleError.apply(console, args); // 元のconsole.errorも呼び出す
};

// 単一インスタンスの確保
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('アプリケーションは既に起動中です。終了します。');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // 誰かが二番目のインスタンスを実行しようとしたときの処理
    console.log('2つ目のインスタンスが起動されました。既存のウィンドウを表示します。');
    
    if (mainWindow) {
      restoreAndFocusWindow();
    }
  });
}


function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, 'assets/icon.png'),
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

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      
      // タスクトレイ格納時の通知を無効化
      // if (process.platform === 'win32' && !tray.isDestroyed()) {
      //   tray.displayBalloon({
      //     iconType: 'info',
      //     title: 'SlackTracker',
      //     content: 'アプリケーションはタスクトレイで動作しています'
      //   });
      // }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    mainWindow.hide();
  });
}

// ウィンドウを確実に復元してフォーカスする関数
function restoreAndFocusWindow() {
  if (!mainWindow) {
    console.error('メインウィンドウが存在しません');
    return;
  }

  console.log('ウィンドウの復元処理を開始します...');
  
  try {
    // 1. ウィンドウの現在状態をログ出力
    console.log(`ウィンドウ状態: 表示=${mainWindow.isVisible()}, 最小化=${mainWindow.isMinimized()}, フォーカス=${mainWindow.isFocused()}`);
    
    // 2. 最小化されている場合は復元
    if (mainWindow.isMinimized()) {
      console.log('最小化状態から復元します');
      mainWindow.restore();
    }
    
    // 3. 非表示の場合は表示
    if (!mainWindow.isVisible()) {
      console.log('非表示状態から表示します');
      mainWindow.show();
    }
    
    // 4. タスクバーに確実に表示
    mainWindow.setSkipTaskbar(false);
    
    // 5. プラットフォーム別のフォーカス処理
    if (process.platform === 'win32') {
      console.log('Windows用のフォーカス処理を実行します');
      
      // ページを完全にリロードしてDOM状態をリセット
      console.log('ページをリロードしてDOM状態をリセットします');
      mainWindow.webContents.reload();
      
      // リロード完了後にフォーカス処理を実行
      mainWindow.webContents.once('did-finish-load', () => {
        console.log('ページリロードが完了しました');
        
        // ウィンドウを表示してフォーカス
        mainWindow.show();
        mainWindow.focus();
        mainWindow.moveTop();
        mainWindow.center();
        
        // 短時間だけ最前面に表示
        mainWindow.setAlwaysOnTop(true);
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setAlwaysOnTop(false);
            console.log('フォーカス処理が完了しました');
          }
        }, 200);
      });
    } else {
      // macOSやLinux用の処理
      mainWindow.focus();
      if (process.platform === 'darwin') {
        app.focus();
      }
      
      // レンダラープロセスにフォーカス復元を通知
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('window-restored');
        }
      }, 100);
    }
    
    // 6. ウィンドウを中央に移動（必要に応じて）
    // mainWindow.center();
    
    console.log('ウィンドウの復元処理が完了しました');
    
  } catch (error) {
    console.error('ウィンドウ復元中にエラーが発生しました:', error);
  }
}

// アプリケーションメニューを作成する関数
function createApplicationMenu() {
  const template = [
    {
      label: 'ファイル',
      submenu: [
        { role: 'quit', label: '終了' }
      ]
    },
    {
      label: 'ヘルプ',
      submenu: [
        /*
        {
          label: 'デバッグログを開く',
          click: () => {
            // debugLogPathが設定されており、ファイルが存在する場合のみ開く
            if (debugLogPath && fs.existsSync(debugLogPath)) {
              shell.openPath(debugLogPath).catch(err => {
                dialog.showErrorBox('エラー', `ログファイルを開けませんでした: ${err.message}`);
                console.error('Failed to open debug log file:', err);
              });
            } else {
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'ログファイル',
                message: 'デバッグログファイルはまだ作成されていません。アプリケーションを操作すると作成されます。'
              });
            }
          }
        },
        */
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets/icon.png');
  tray = new Tray(iconPath);
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '終了',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip('SlackTracker - 生産性追跡ツール');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      restoreAndFocusWindow();
    }
  });
  
  tray.on('double-click', () => {
    restoreAndFocusWindow();
  });
}


// Node.js バックエンドを初期化
async function initializeBackend() {
  try {
    const userDataPath = app.getPath('userData');
    console.log('ユーザーデータパス:', userDataPath);
    console.log('アプリがパッケージ化されている:', app.isPackaged);
    console.log('現在の作業ディレクトリ:', process.cwd());
    
    writeDebugLog(`初期化開始 - ユーザーデータパス: ${userDataPath}`);
    writeDebugLog(`パッケージ化: ${app.isPackaged}`);
    
    taskManager = new TaskManager(userDataPath);
    await taskManager.initialize();
    console.log('Node.js TaskManager を初期化しました');
    writeDebugLog('TaskManager初期化完了');

    // データディレクトリの存在と書き込み権限をチェック
    try {
      await fs.promises.mkdir(taskManager.dataDir, { recursive: true });
      const testFile = path.join(taskManager.dataDir, 'write_test.tmp');
      await fs.promises.writeFile(testFile, 'test');
      await fs.promises.unlink(testFile);
      writeDebugLog(`データディレクトリの書き込み権限を確認しました: ${taskManager.dataDir}`);
    } catch (error) {
      console.error('データディレクトリのセットアップに失敗しました:', error);
      writeDebugLog(`データディレクトリのセットアップエラー: ${error.message}`);
      dialog.showErrorBox(
        '致命的なエラー',
        `データディレクトリのセットアップに失敗しました。\nパス: ${taskManager.dataDir}\nエラー: ${error.message}\n\nアプリケーションを再インストールするか、管理者として実行してみてください。`
      );
      app.quit();
      return;
    }

    // パッケージ版では初期化完了を通知で確認
    if (!app.isPackaged) {
      /* dialog.showMessageBox(null, {
        type: "info",
        title: "初期化完了",
        message: `TaskManager初期化完了\nデータディレクトリ: ${taskManager.dataDir}\n\nデバッグログ: ${path.join(userDataPath, "debug.log")}`
      }); */
    }
  } catch (error) {
    console.error('TaskManager初期化エラー:', error);
    writeDebugLog(`初期化エラー: ${error.message}`);
    if (app.isPackaged) {
      dialog.showErrorBox('初期化エラー', `TaskManager初期化に失敗しました: ${error.message}`);
    }
    throw error;
  }
}


app.whenReady().then(async () => {
  // debugLogPathを初期化（initializeBackendより前に実行される可能性のあるログのため）
  debugLogPath = path.join(app.getPath('userData'), 'debug.log');

  await initializeBackend();
  
  // 設定を読み込み
  await loadSettings();
  
  createWindow();
  createApplicationMenu(); // アプリケーションメニューを作成
  createTray(); // システムトレイを作成
  
  // ホットキーを登録
  registerHotkeys();

  // Expressサーバーを起動
  const expressApp = createApp(taskManager);
  const server = expressApp.app.listen(0, () => { // 0番ポートで利用可能なポートを自動的に選択
    const port = server.address().port;
    console.log(`Expressサーバーがポート${port}で起動しました`);
    // レンダラープロセスにポート番号を渡す
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('set-api-port', port);
    });
  });

  console.log('アプリケーションの初期化が完了しました');
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // システムトレイに残すため、アプリを終了しない
  // macOSでも同様の動作にする
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('will-quit', () => {
  // ホットキーを解除
  unregisterAllHotkeys();
  
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }
});

// メインプロセスでの未捕捉例外をキャッチ
process.on('uncaughtException', (error) => {
  console.error('メインプロセスで未捕捉の例外が発生しました:', error);
  dialog.showErrorBox('致命的なエラー', `アプリケーションで予期せぬエラーが発生しました: ${error.message}

詳細はデバッグログを確認してください。`);
  app.quit();
});

// レンダラープロセスでのクラッシュをキャッチ
app.on('render-process-gone', (event, webContents, details) => {
  console.error('レンダラープロセスがクラッシュまたは終了しました:', details);
  dialog.showErrorBox('レンダラープロセスエラー', `レンダラープロセスがクラッシュまたは終了しました: ${details.reason}

詳細はデバッグログを確認してください。`);
});

// webContentsのエラーをキャッチ
// did-fail-load: ページの読み込みに失敗したとき
// crashed: レンダラープロセスがクラッシュしたとき
// unresponsive: レンダラープロセスが応答しなくなったとき
app.on('web-contents-created', (event, contents) => {
  contents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`ページの読み込みに失敗しました: ${validatedURL}, エラー: ${errorCode} - ${errorDescription}`);
    dialog.showErrorBox('ページ読み込みエラー', `ページの読み込みに失敗しました: ${errorDescription}`);
  });

  contents.on('crashed', (event, killed) => {
    console.error('レンダラープロセスがクラッシュしました。');
    dialog.showErrorBox('レンダラークラッシュ', 'レンダラープロセスがクラッシュしました。アプリケーションを再起動してください。');
  });

  contents.on('unresponsive', () => {
    console.warn('レンダラープロセスが応答しません。');
    dialog.showErrorBox('応答なし', 'レンダラープロセスが応答しません。');
  });
});

// 設定管理機能
function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function loadSettings() {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const data = await fs.promises.readFile(settingsPath, 'utf8');
      settings = JSON.parse(data);
    } else {
      settings = {
        globalHotkey: {
          toggleWindow: ''
        }
      };
    }
    console.log('設定を読み込みました:', settings);
  } catch (error) {
    console.error('設定の読み込みに失敗しました:', error);
    settings = {
      globalHotkey: {
        toggleWindow: ''
      }
    };
  }
}

async function saveSettings(newSettings) {
  try {
    const settingsPath = getSettingsPath();
    await fs.promises.writeFile(settingsPath, JSON.stringify(newSettings, null, 2));
    
    // 古いホットキーを解除
    unregisterAllHotkeys();
    
    // 新しい設定を保存
    settings = newSettings;
    
    // 新しいホットキーを登録
    registerHotkeys();
    
    console.log('設定を保存しました:', settings);
    return true;
  } catch (error) {
    console.error('設定の保存に失敗しました:', error);
    return false;
  }
}

// ホットキー管理機能
function registerHotkeys() {
  if (!settings.globalHotkey) return;
  
  // アプリの表示/非表示切り替え
  if (settings.globalHotkey.toggleWindow) {
    try {
      const success = globalShortcut.register(settings.globalHotkey.toggleWindow, () => {
        console.log('アプリの表示/非表示を切り替えます');
        toggleWindowVisibility();
      });
      
      if (success) {
        registeredHotkeys.push(settings.globalHotkey.toggleWindow);
        console.log(`ホットキー「${settings.globalHotkey.toggleWindow}」を登録しました (アプリ表示/非表示)`);
      } else {
        console.error(`ホットキー「${settings.globalHotkey.toggleWindow}」の登録に失敗しました`);
      }
    } catch (error) {
      console.error('ホットキー登録エラー:', error);
    }
  }
}

function unregisterAllHotkeys() {
  registeredHotkeys.forEach(hotkey => {
    globalShortcut.unregister(hotkey);
    console.log(`ホットキー「${hotkey}」を解除しました`);
  });
  registeredHotkeys = [];
}

function toggleWindowVisibility() {
  if (!mainWindow) return;
  
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    restoreAndFocusWindow();
  }
}

function showWindow() {
  if (!mainWindow) return;
  
  if (!mainWindow.isVisible()) {
    restoreAndFocusWindow();
  }
}

// IPC handlers (変更なし)
ipcMain.handle('get-tasks', async () => {
  try {
    if (!taskManager) {
      console.error('TaskManagerが初期化されていません');
      return [];
    }
    const tasks = await taskManager.loadSchedule();
    return tasks;
  } catch (error) {
    console.error('タスク取得エラー:', error);
    writeDebugLog(`get-tasks エラー: ${error.message}`);
    return [];
  }
});

ipcMain.handle('add-task', async (event, taskName, isBreak = false) => {
  try {
    if (!taskManager) {
      const errorMsg = 'TaskManagerが初期化されていません';
      console.error(errorMsg);
      // デバッグ用通知（パッケージ版で確認）
      if (!app.isPackaged) {
        dialog.showErrorBox('エラー', errorMsg);
      }
      return { success: false, error: errorMsg };
    }
    console.log('タスク追加リクエスト:', { taskName, isBreak });
    writeDebugLog(`タスク追加リクエスト: ${taskName}, isBreak: ${isBreak}`);
    
    // データディレクトリ情報をデバッグ出力
    if (app.isPackaged) {
      console.log('パッケージ版 - データディレクトリ:', taskManager.dataDir);
      console.log('パッケージ版 - ユーザーデータパス:', app.getPath('userData'));
      writeDebugLog(`データディレクトリ: ${taskManager.dataDir}`);
    }
    
    const newTask = await taskManager.addTask(taskName, isBreak);
    writeDebugLog(`タスク追加結果: ${newTask ? 'SUCCESS' : 'NULL'}`);
    console.log('タスク追加結果:', newTask);
    if (newTask) {
      return { success: true, task: newTask, taskId: newTask.id };
    } else {
      const errorMsg = 'addTaskがnullを返しました - TaskManager内でエラーが発生した可能性があります';
      console.error(errorMsg);
      if (!app.isPackaged) {
        dialog.showErrorBox('タスク追加エラー', `${errorMsg}\n\nデバッグ情報:\n- データディレクトリ: ${taskManager.dataDir}\n- 初期化状態: ${taskManager.initialized}`);
      }
      return { success: false, error: errorMsg };
    }
  } catch (error) {
    console.error('タスク追加エラー:', error);
    writeDebugLog(`add-task エラー: ${error.message}\n${error.stack}`);
    if (!app.isPackaged) {
      dialog.showErrorBox('タスク追加エラー', `エラー詳細: ${error.message}\nデータディレクトリ: ${taskManager ? taskManager.dataDir : 'undefined'}`);
    }
    return { success: false, error: error.message };
  }
});

ipcMain.handle('end-task', async () => {
  try {
    const endedTask = await taskManager.endCurrentTask();
    if (endedTask) {
      return { success: true, task: endedTask };
    } else {
      return { success: false, error: '終了するタスクがありません' };
    }
  } catch (error) {
    console.error('タスク終了エラー:', error);
    writeDebugLog(`end-task エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('copy-timeline', async () => {
  try {
    const timelineText = await taskManager.getTimelineText();
    if (timelineText) {
      const { clipboard } = require('electron');
      clipboard.writeText(timelineText);
      return { success: true, message: 'タイムラインをコピーしました' };
    } else {
      return { success: false, error: 'コピーするデータがありません' };
    }
  } catch (error) {
    console.error('タイムラインコピーエラー:', error);
    writeDebugLog(`copy-timeline エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('clear-all-tasks', async () => {
  try {
    const success = await taskManager.clearAllTasks();
    if (success) {
      return { success: true, message: 'すべてのタスクをクリアしました' };
    } else {
      return { success: false, error: 'タスクのクリアに失敗しました' };
    }
  } catch (error) {
    console.error('タスククリアエラー:', error);
    writeDebugLog(`clear-all-tasks エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update-task', async (event, taskId, taskData) => {
  try {
    const result = await taskManager.updateTask(taskId, taskData.name, taskData.startTime, taskData.endTime);
    if (result) {
      const responseData = { success: true, task: result.task };
      if (result.adjustments) {
        responseData.adjustments = result.adjustments;
      }
      return responseData;
    } else {
      return { success: false, error: 'タスクが見つかりません' };
    }
  } catch (error) {
    console.error('タスク更新エラー:', error);
    writeDebugLog(`update-task エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-task', async (event, taskId) => {
  try {
    console.log('削除リクエスト - タスクID:', taskId);
    
    if (taskId === null || taskId === undefined) {
      return { success: false, error: 'タスクIDが無効です' };
    }
    
    const deletedTask = await taskManager.deleteTask(taskId);
    if (deletedTask) {
      return { success: true, task: deletedTask };
    } else {
      return { success: false, error: 'タスクが見つかりません' };
    }
  } catch (error) {
    console.error('タスク削除エラー:', error);
    writeDebugLog(`delete-task エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
});



ipcMain.handle('get-report', async () => {
  try {
    const content = await taskManager.loadReport();
    return { success: true, content: content };
  } catch (error) {
    console.error('報告書取得エラー:', error);
    writeDebugLog(`get-report エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-report', async (event, content) => {
  try {
    const success = await taskManager.saveReport(content);
    if (success) {
      return { success: true, message: '報告書を保存しました' };
    } else {
      return { success: false, error: '報告書の保存に失敗しました' };
    }
  } catch (error) {
    console.error('報告書保存エラー:', error);
    writeDebugLog(`save-report エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-report-urls', async () => {
  try {
    const urls = await taskManager.loadReportUrls();
    return { success: true, urls: urls };
  } catch (error) {
    console.error('報告先URL取得エラー:', error);
    writeDebugLog(`get-report-urls エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('add-report-url', async (event, name, url) => {
  try {
    const newUrl = await taskManager.addReportUrl(name, url);
    if (newUrl) {
      return { success: true, url: newUrl };
    } else {
      return { success: false, error: 'URLの追加に失敗しました' };
    }
  } catch (error) {
    console.error('報告先URL追加エラー:', error);
    writeDebugLog(`add-report-url エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-report-url', async (event, urlId) => {
  try {
    const deletedUrl = await taskManager.deleteReportUrl(urlId);
    if (deletedUrl) {
      return { success: true, url: deletedUrl };
    } else {
      return { success: false, error: 'URLが見つかりません' };
    }
  } catch (error) {
    console.error('報告先URL削除エラー:', error);
    writeDebugLog(`delete-report-url エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
});



ipcMain.handle('get-report-tabs', async () => {
  try {
    // データ移行を確認
    await taskManager.migrateLegacyReportData();
    
    const tabData = await taskManager.loadReportTabs();
    return { success: true, tabs: tabData };
  } catch (error) {
    console.error('報告タブ取得エラー:', error);
    writeDebugLog(`get-report-tabs エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-report-tab-content', async (event, tabId) => {
  try {
    const content = await taskManager.getReportTabContent(tabId);
    return { success: true, content: content };
  } catch (error) {
    console.error('報告タブ内容取得エラー:', error);
    writeDebugLog(`get-report-tab-content エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-report-tab-content', async (event, tabId, content) => {
  try {
    const success = await taskManager.saveReportTabContent(tabId, content);
    if (success) {
      return { success: true, message: '報告内容を保存しました' };
    }
    else {
      return { success: false, error: '報告内容の保存に失敗しました' };
    }
  } catch (error) {
    console.error('報告タブ内容保存エラー:', error);
    writeDebugLog(`save-report-tab-content エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// 設定管理のIPCハンドラ
ipcMain.handle('get-settings', async () => {
  try {
    return settings;
  } catch (error) {
    console.error('設定取得エラー:', error);
    writeDebugLog(`get-settings エラー: ${error.message}`);
    return {
      globalHotkey: {
        toggleWindow: ''
      }
    };
  }
});

ipcMain.handle('save-settings', async (event, newSettings) => {
  try {
    const success = await saveSettings(newSettings);
    return success;
  } catch (error) {
    console.error('設定保存エラー:', error);
    writeDebugLog(`save-settings エラー: ${error.message}`);
    return false;
  }
});
class NippoApp {
    constructor() {
        this.tasks = [];
        this.currentTaskId = null;
        this.currentTabId = 'default';
        this.reportUrls = [];
        this.toastTimer = null;
        this.originalReportContent = '';
        this.originalTabContents = new Map();
        this.hasUnsavedChanges = false;
        this.taskStock = [];
        this.goalStock = [];
        this.tempGoalStock = [];
        this.tempTaskStock = [];
        this.hasGoalStockChanges = false;
        this.hasTaskStockChanges = false;
        this.eventListenersInitialized = false;
        this.currentHotkeyTarget = null;
        this.isCapturingHotkey = false;
        this.settings = {};
        this.currentMode = 'today';
        this.selectedDate = null;
        this.currentDate = null; // 統一された日付管理（null = 今日）
        this.historyDates = [];
        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.updateDateTime();
        this.updateTaskCounter();
        this.updateBreakButton(false); // 初期状態は休憩開始ボタン

        // タスク入力フォーカスのイベントリスナーを追加（重複防止）
        if (!this.eventListenersInitialized) {
            window.electronAPI.onFocusTaskInput(() => {
                const taskInput = document.getElementById('task-input');
                if (taskInput) {
                    taskInput.focus();
                }
            });
            
            // ウィンドウ復元時の処理を追加
            window.electronAPI.onWindowRestored(() => {
                console.log('ウィンドウが復元されました - DOM状態を確認中...');
                this.handleWindowRestored();
            });
            
            
            
            this.eventListenersInitialized = true;
        }

        // APIサーバーのポートを取得し、準備を待つ
        window.electronAPI.onApiPort(async (port) => {
            console.log(`APIポートを受信: ${port}`);
            this.apiPort = port;
            this.apiBaseUrl = `http://localhost:${port}`;

            console.log('APIサーバーの準備を待機中...');
            const isApiReady = await this.waitForAPI();

            if (isApiReady) {
                // 起動時に既存データを読み込み
                console.log('アプリ起動時のデータ読み込み開始...');
                await this.loadTasks();
                
                // 履歴データを読み込み
                await this.loadHistoryDates();
                
                // 目標ストックを読み込み
                await this.loadGoalStock();
                
                // 設定を読み込み
                try {
                    await this.loadSettings();
                } catch (error) {
                    console.error('設定の読み込みに失敗しました:', error);
                }
            } else {
                console.error('APIの準備が完了しなかったため、タスクを読み込めません。');
                // ここでユーザーにエラーメッセージを表示するなどの処理を追加できます
            }
        });

        // 1分ごとに時刻を更新
        setInterval(() => this.updateDateTime(), 60000);
    }

    async waitForAPI() {
        const maxRetries = 30; // 30秒まで待機
        for (let i = 0; i < maxRetries; i++) {
            try {
                console.log(`API接続確認 ${i + 1}/${maxRetries}...`);
                const response = await fetch(`${this.apiBaseUrl}/api/health`);
                if (response.ok) {
                    const result = await response.json();
                    if (result.status === 'healthy') {
                        console.log('API接続成功 - サーバー準備完了');
                        return true;
                    }
                }
            } catch (error) {
                console.log(`API接続待機中... (${error.message})`);
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        console.error('API接続がタイムアウトしました');
        return false;
    }

    setupEventListeners() {
        // タスク追加
        const addBtn = document.getElementById('add-task-btn');
        const taskInput = document.getElementById('task-input');
        
        addBtn.addEventListener('click', () => this.addTask());
        taskInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addTask();
        });

        // タスク終了
        document.getElementById('end-task-btn').addEventListener('click', () => this.endTask());

        // 休憩開始/終了
        document.getElementById('break-btn').addEventListener('click', () => this.toggleBreak());

        // タイムラインコピー
        document.getElementById('copy-timeline-btn').addEventListener('click', () => this.copyTimeline());

        // すべてクリア（設定画面で初期化される）

        // 履歴機能
        document.getElementById('today-btn').addEventListener('click', () => this.switchToTodayMode());
        document.getElementById('history-btn').addEventListener('click', () => this.switchToHistoryMode());
        
        // 日付入力イベントリスナーを遅延追加（DOM確実に存在する状態で）
        setTimeout(() => {
            const calendarInput = document.getElementById('calendar-date-input');
            if (calendarInput) {
                // 未来の日付を選択できないように制限
                const today = new Date();
                calendarInput.max = today.toISOString().split('T')[0];
                
                calendarInput.addEventListener('change', (e) => {
                    console.log('日付変更イベントが発生しました:', e.target.value);
                    this.onDateSelected(e.target.value);
                });
                calendarInput.setAttribute('data-has-listener', 'true');
                console.log('日付入力イベントリスナーを追加しました');
                
                // テスト用のグローバル関数を追加
                window.testDateSelection = (dateString) => {
                    console.log('テスト用日付選択:', dateString);
                    this.onDateSelected(dateString);
                };
            } else {
                console.error('calendar-date-inputが見つかりません');
            }
            
        }, 100);

        // 報告書作成
        document.getElementById('create-report-btn').addEventListener('click', () => this.showReportDialog());

        // 設定
        document.getElementById('settings-btn').addEventListener('click', () => this.openSettingsDialog());

        // 目標ストック
        document.getElementById('goal-stock-btn').addEventListener('click', () => this.showGoalStockDialog());

        // タスクストック
        document.getElementById('task-stock-btn').addEventListener('click', () => this.showTaskStockDialog());

        // タイトルバーボタン
        document.querySelector('.titlebar-button.minimize').addEventListener('click', () => {
            window.close(); // 最小化はcloseイベントで処理されタスクトレイに格納される
        });

        document.querySelector('.titlebar-button.close').addEventListener('click', () => {
            window.close();
        });

        // 確認ダイアログのイベントリスナー
        document.getElementById('confirm-cancel').addEventListener('click', () => this.hideConfirmDialog());
        document.getElementById('confirm-ok').addEventListener('click', () => this.executeConfirmedAction());

        // 編集ダイアログのイベントリスナー
        document.getElementById('edit-close').addEventListener('click', () => this.hideEditDialog());
        document.getElementById('edit-cancel').addEventListener('click', () => this.hideEditDialog());
        document.getElementById('edit-save').addEventListener('click', () => this.saveTask());
        document.getElementById('edit-delete').addEventListener('click', () => this.deleteCurrentTask());

        // 報告書ダイアログのイベントリスナー
        document.getElementById('report-close').addEventListener('click', () => this.handleReportClose());
        document.getElementById('report-cancel').addEventListener('click', () => this.handleReportClose());
        document.getElementById('copy-goals-btn').addEventListener('click', () => this.copyGoals());
        document.getElementById('report-copy').addEventListener('click', () => this.copyReport());
        document.getElementById('report-save').addEventListener('click', () => this.saveReport());

        // 設定ダイアログのイベントリスナー
        document.getElementById('settings-close').addEventListener('click', () => this.closeSettingsDialog());
        document.getElementById('settings-cancel').addEventListener('click', () => this.closeSettingsDialog());
        document.getElementById('settings-save').addEventListener('click', () => this.saveSettings());
        document.getElementById('add-url-btn').addEventListener('click', () => this.addReportUrl());
        document.getElementById('clear-all-btn').addEventListener('click', () => this.showClearConfirmation());
        
        // ホットキー入力フィールドのイベントリスナー
        document.getElementById('hotkey-toggle').addEventListener('click', () => this.startHotkeyCapture('hotkey-toggle'));
        
        // クリアボタンのイベントリスナー
        document.querySelectorAll('.clear-hotkey').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.target.closest('.clear-hotkey').dataset.target;
                this.clearHotkey(target);
            });
        });
        

        // 目標ストックダイアログのイベントリスナー
        document.getElementById('goal-stock-close').addEventListener('click', () => this.hideGoalStockDialog());
        document.getElementById('goal-stock-cancel').addEventListener('click', () => this.hideGoalStockDialog());
        document.getElementById('add-goal-stock-btn').addEventListener('click', () => this.addGoalStock());
        document.getElementById('save-goal-stock-btn').addEventListener('click', () => this.saveGoalStockChanges());
        
        // 目標ストック入力のEnterキー対応
        document.getElementById('goal-stock-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addGoalStock();
        });

        // タスクストックダイアログのイベントリスナー
        document.getElementById('task-stock-close').addEventListener('click', () => this.hideTaskStockDialog());
        document.getElementById('task-stock-cancel').addEventListener('click', () => this.hideTaskStockDialog());
        document.getElementById('add-task-stock-btn').addEventListener('click', () => this.addTaskStock());
        document.getElementById('save-task-stock-btn').addEventListener('click', () => this.saveTaskStockChanges());
        
        // タスクストック入力のEnterキー対応
        document.getElementById('task-stock-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addTaskStock();
        });
        
        // ホットキーキャプチャ用のキーボードイベントリスナー
        document.addEventListener('keydown', (e) => {
            if (this.isCapturingHotkey) {
                this.captureHotkey(e);
            }
        });
    }

    updateDateTime() {
        const now = new Date();
        const dateElement = document.getElementById('current-date');
        const timeElement = document.getElementById('current-time');

        // 時刻は常に更新（履歴モードでは非表示になるため問題なし）
        const timeStr = now.toLocaleTimeString('ja-JP', {
            hour: '2-digit',
            minute: '2-digit'
        });
        timeElement.textContent = timeStr;

        // 日付は今日モードの時のみ更新（履歴モードでは履歴日付を保持）
        if (this.currentMode !== 'history') {
            const dateStr = now.toLocaleDateString('ja-JP', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long'
            });
            dateElement.textContent = dateStr;
        }
    }

    getTime() {
        const now = new Date();
        const hour = now.getHours();
        const minute = now.getMinutes();
        
        let period = '午前';
        let displayHour = hour;
        
        if (hour === 0) {
            displayHour = 12;
        } else if (hour === 12) {
            period = '午後';
        } else if (hour > 12) {
            displayHour = hour - 12;
            period = '午後';
        }
        
        return `${period} ${displayHour}:${minute.toString().padStart(2, '0')}`;
    }

    async addTask() {
        const taskInput = document.getElementById('task-input');
        const taskName = taskInput.value.trim();

        if (!taskName) {
            this.showToast('タスク名を入力してください', 'warning');
            return;
        }

        console.log('=== addTask 開始 ===');
        console.log('currentMode:', this.currentMode);
        console.log('currentDate:', this.currentDate);
        console.log('selectedDate:', this.selectedDate);

        // 履歴モードで日付が未選択の場合は追加を阻止
        if (this.currentMode === 'history' && !this.currentDate) {
            console.log('履歴モードで日付未選択のため、タスク追加を阻止');
            this.showToast('履歴モードでは先に日付を選択してください', 'warning');
            return;
        }

        // 現在実行中のタスクがあるかチェック
        const currentRunningTask = this.tasks.find(task => !task.endTime);
        
        try {
            // 統一されたAPI呼び出し（日付パラメータ付き）
            const requestData = { 
                name: taskName, 
                isBreak: false,
                dateString: this.currentDate // null = 今日、文字列 = 指定日
            };
            
            console.log('API リクエストデータ:', requestData);
            
            const response = await fetch(`${this.apiBaseUrl}/api/tasks`, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify(requestData) 
            });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    taskInput.value = '';
                    
                    // 統一されたタスク読み込み
                    if (this.currentDate) {
                        // 履歴データの場合 - 自動でデータを読み込み、作成されている
                        await this.loadHistoryData(this.currentDate);
                    } else {
                        // 今日のデータの場合
                        await this.loadTasks();
                    }
                    
                    // 前のタスクが自動終了された場合の通知
                    if (currentRunningTask) {
                        this.showToast(`「${currentRunningTask.name}」を終了し、「${taskName}」を開始しました`);
                    } else {
                        this.showToast(`タスク「${taskName}」を開始しました`);
                    }
                    
                    // 今日のタスクの場合のみ現在タスクを更新
                    if (!this.currentDate) {
                        this.currentTaskId = result.taskId;
                        this.updateCurrentTask(taskName);
                    }
                }
            }
        } catch (error) {
            console.error('タスク追加エラー:', error);
            this.showToast('タスクの追加に失敗しました', 'error');
        }
    }


    async toggleBreak() {
        // 現在実行中のタスクがあるかチェック
        const currentRunningTask = this.tasks.find(task => !task.endTime);
        
        if (currentRunningTask && currentRunningTask.isBreak) {
            // 休憩中の場合は休憩を終了
            await this.endBreak();
        } else {
            // 休憩中でない場合は休憩を開始
            await this.startBreak();
        }
    }

    async startBreak() {
        // 現在実行中のタスクがあるかチェック
        const currentRunningTask = this.tasks.find(task => !task.endTime);
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '休憩', isBreak: true }) });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    await this.loadTasks();
                    
                    // 前のタスクが自動終了された場合の通知
                    if (currentRunningTask) {
                        this.showToast(`「${currentRunningTask.name}」を終了し、休憩を開始しました`);
                    } else {
                        this.showToast('休憩を開始しました');
                    }
                }
            }
        } catch (error) {
            console.error('休憩開始エラー:', error);
            this.showToast('休憩の開始に失敗しました', 'error');
        }
    }

    async endBreak() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/tasks/end`, { method: 'POST' });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    await this.loadTasks();
                    this.showToast('休憩を終了しました');
                }
            }
        } catch (error) {
            console.error('休憩終了エラー:', error);
            this.showToast('休憩の終了に失敗しました', 'error');
        }
    }

    async endTask() {
        // 過去日付では今日のタスク操作を無効化
        if (this.currentDate) {
            this.showToast('過去日付ではタスクを終了できません', 'warning');
            return;
        }
        
        // 実行中のタスクがあるかチェック
        const runningTask = this.tasks.find(task => !task.endTime);
        
        if (!runningTask) {
            this.showToast('終了するタスクがありません', 'warning');
            return;
        }

        try {
            const response = await fetch(`${this.apiBaseUrl}/api/tasks/end`, { method: 'POST' });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    await this.loadTasks();
                    this.showToast(`タスク「${runningTask.name}」を終了しました`);
                    this.currentTaskId = null;
                    this.updateCurrentTask('タスクなし');
                }
            }
        } catch (error) {
            console.error('タスク終了エラー:', error);
            this.showToast('タスクの終了に失敗しました', 'error');
        }
    }

    async copyTimeline() {
        try {
            const result = await window.electronAPI.copyTimeline();
            if (result.success) {
                this.showToast('タイムラインをクリップボードにコピーしました');
            } else {
                this.showToast(result.error || 'コピーに失敗しました', 'error');
            }
        } catch (error) {
            console.error('コピーエラー:', error);
            this.showToast('コピーに失敗しました', 'error');
        }
    }

    async loadTasks() {
        try {
            console.log('今日のタスクデータの読み込みを開始...');
            // 今日のタスクを読み込む際は currentDate を null に設定
            this.currentDate = null;
            console.log('currentDate を null に設定しました (今日モード)');
            
            const response = await fetch(`${this.apiBaseUrl}/api/tasks`);
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    const tasks = result.tasks;
                    console.log('読み込まれたタスク数:', tasks.length);
                    console.log('タスクデータ:', tasks);

                    this.tasks = tasks;
                    this.updateTimeline();
                    this.updateStats();
                    this.updateTaskCounter();

                    // 現在実行中のタスクを更新
                    const runningTask = this.tasks.find(task => !task.endTime);
                    if (runningTask) {
                        console.log('実行中のタスク:', runningTask);
                        this.currentTaskId = runningTask.id;
                        if (runningTask.isBreak) {
                            this.updateCurrentTask('🔴 休憩中');
                            this.updateBreakButton(true); // 休憩中の場合は終了ボタンに変更
                        } else {
                            this.updateCurrentTask(runningTask.name);
                            this.updateBreakButton(false); // 通常タスクの場合は開始ボタンに変更
                        }
                    } else {
                        console.log('実行中のタスクはありません');
                        this.currentTaskId = null;
                        this.updateCurrentTask('タスクなし');
                        this.updateBreakButton(false); // タスクなしの場合は開始ボタン
                    }

                    console.log('タスクデータの読み込み完了');
                }
            }
        } catch (error) {
            console.error('タスク読み込みエラー:', error);
        }
    }

    updateTimeline() {
        const container = document.getElementById('timeline-container');
        
        console.log('タイムライン更新中...', this.tasks);
        
        if (this.tasks.length === 0) {
            console.log('タスクが0件のため空表示');
            container.innerHTML = `
                <div class="timeline-empty">
                    <span class="material-icons">schedule</span>
                    <p>まだタスクがありません</p>
                    <p class="sub-text">新しいタスクを追加してください</p>
                </div>
            `;
            return;
        }

        const timelineHTML = this.tasks.map(task => {
            const startTime = this.formatTime(task.startTime);
            const endTime = task.endTime ? this.formatTime(task.endTime) : '実行中';
            const duration = task.endTime ? this.calculateDuration(task.startTime, task.endTime) : '';
            const isRunning = !task.endTime;
            const isBreak = task.isBreak || false;
            
            // デバッグ情報
            if (task.endTime) {
                console.log('タスク詳細:', {
                    name: task.name,
                    startTime: task.startTime,
                    endTime: task.endTime,
                    duration: duration,
                    isBreak: isBreak
                });
            }
            
            // クラスを動的に設定
            let itemClass = 'timeline-item';
            if (isRunning && isBreak) {
                // 実行中の休憩のみ特別なスタイル
                itemClass += ' running break';
            } else if (isRunning) {
                // 実行中の通常タスク
                itemClass += ' running';
            }
            // 終了した休憩タスクは通常のタスクと同じ表示にする
            
            // タスク名を表示用に整形（休憩の場合は適切に表示）
            let displayName = task.name;
            if (isBreak) {
                if (displayName === '[BREAK] 休憩' || displayName === '🔴 休憩' || displayName === '') {
                    displayName = '休憩';
                } else if (displayName.startsWith('[BREAK] ')) {
                    displayName = displayName.replace('[BREAK] ', '');
                } else if (displayName.startsWith('🔴 休憩: ')) {
                    displayName = displayName.replace('🔴 休憩: ', '');
                } else if (displayName.startsWith('🔴 休憩')) {
                    displayName = displayName.replace('🔴 休憩', '').trim();
                    if (!displayName) displayName = '休憩';
                }
            }
            
            return `
                <div class="${itemClass}">
                    <div class="timeline-time">${startTime}</div>
                    <div class="timeline-content">
                        <div class="timeline-task" onclick="app.copyTaskToInput('${displayName.replace(/'/g, "\'")}', event)" oncontextmenu="app.copyTaskToInput('${displayName.replace(/'/g, "\'")}', event)" title="クリックでタスク名をコピー">${displayName}</div>
                        ${duration ? `<span class="timeline-duration">${duration}</span>` : ''}
                        ${isRunning ? `<span class="timeline-duration" style="background: ${isBreak ? 'var(--warning)' : 'var(--accent)'}; color: ${isBreak ? 'var(--bg-primary)' : 'white'};">${isBreak ? '休憩中' : '実行中'}</span>` : ''}
                    </div>
                    <button class="timeline-edit" onclick="app.editTask('${task.id}')" title="編集">
                        <span class="material-icons">edit</span>
                    </button>
                </div>
            `;
        }).join('');

        container.innerHTML = timelineHTML;
    }

    updateStats() {
        // 休憩以外の完了したタスクのみをカウント
        const completedWorkTasks = this.tasks.filter(task => task.endTime && !task.isBreak).length;
        const totalWorkTime = this.calculateTotalWorkTime();
        const productivity = this.calculateProductivity();

        document.getElementById('completed-tasks').textContent = completedWorkTasks;
        document.getElementById('work-time').textContent = totalWorkTime;
        document.getElementById('productivity').textContent = productivity;
    }

    updateTaskCounter() {
        const activeTasks = this.tasks.filter(task => !task.endTime).length;
        document.getElementById('task-count').textContent = activeTasks;
        
        // 実行中のタスクがない場合はタスク終了ボタンを非表示
        this.updateEndTaskButtonVisibility();
    }

    updateEndTaskButtonVisibility() {
        const endTaskBtn = document.getElementById('end-task-btn');
        const runningTasks = this.tasks.filter(task => !task.endTime);
        const isOnBreak = runningTasks.some(task => task.isBreak);
        
        // 実行中のタスクがない、または休憩中の場合は非表示
        if (runningTasks.length === 0 || isOnBreak) {
            endTaskBtn.style.display = 'none';
        } else {
            endTaskBtn.style.display = 'flex';
        }
    }

    updateCurrentTask(taskName) {
        document.getElementById('current-task').textContent = taskName;
    }

    updateBreakButton(isOnBreak) {
        const breakBtn = document.getElementById('break-btn');
        const icon = breakBtn.querySelector('.material-icons');
        const text = breakBtn.querySelector('span:not(.material-icons)') || breakBtn.childNodes[breakBtn.childNodes.length - 1];
        
        if (isOnBreak) {
            // 休憩終了ボタンに変更
            icon.textContent = 'stop_circle';
            if (text.nodeType === Node.TEXT_NODE) {
                text.textContent = '休憩終了';
            } else {
                breakBtn.innerHTML = '<span class="material-icons">stop_circle</span>休憩終了';
            }
            breakBtn.classList.remove('btn-break');
            breakBtn.classList.add('btn-secondary');
        } else {
            // 休憩開始ボタンに変更
            icon.textContent = 'coffee';
            if (text.nodeType === Node.TEXT_NODE) {
                text.textContent = '休憩開始';
            }
            else {
                breakBtn.innerHTML = '<span class="material-icons">coffee</span>休憩開始';
            }
            breakBtn.classList.remove('btn-secondary');
            breakBtn.classList.add('btn-break');
        }
        
        // タスク終了ボタンの表示状態を更新
        this.updateEndTaskButtonVisibility();
    }

    formatTime(timeString) {
        // "午前 10:30" -> "10:30"
        if (!timeString) return '';
        return timeString.replace('午前 ', '').replace('午後 ', '');
    }

    // 12時間形式（午前/午後）を24時間形式（HH:mm）に変換
    convertTo24Hour(timeString) {
        if (!timeString) return '';
        
        const isAM = timeString.includes('午前');
        const timeOnly = timeString.replace('午前 ', '').replace('午後 ', '').trim();
        
        if (!timeOnly.includes(':')) return '';
        
        const [hours, minutes] = timeOnly.split(':');
        let hour = parseInt(hours);
        
        if (!isAM && hour !== 12) {
            hour += 12;
        } else if (isAM && hour === 12) {
            hour = 0;
        }
        
        return `${hour.toString().padStart(2, '0')}:${minutes.padStart(2, '0')}`;
    }

    // 24時間形式（HH:mm）を12時間形式（午前/午後）に変換
    convertTo12Hour(timeString) {
        if (!timeString) return '';
        
        const [hours, minutes] = timeString.split(':');
        let hour = parseInt(hours);
        const minute = minutes;
        
        let period = '午前';
        if (hour === 0) {
            hour = 12;
        } else if (hour === 12) {
            period = '午後';
        } else if (hour > 12) {
            hour -= 12;
            period = '午後';
        }
        
        return `${period} ${hour}:${minute}`;
    }

    calculateDuration(startTime, endTime) {
        if (!startTime || !endTime) return '';
        
        try {
            // "午前 10:30" -> Date オブジェクトに変換
            const parseTime = (timeStr) => {
                console.log('パース対象:', timeStr); // デバッグ用
                
                const isAM = timeStr.includes('午前');
                const timeOnly = timeStr.replace('午前 ', '').replace('午後 ', '').trim();
                
                // 時間フォーマットの検証
                if (!timeOnly.includes(':')) {
                    console.error('無効な時間フォーマット:', timeOnly);
                    return null;
                }
                
                const timeParts = timeOnly.split(':');
                if (timeParts.length !== 2) {
                    console.error('時間の分割に失敗:', timeParts);
                    return null;
                }
                
                const hours = parseInt(timeParts[0], 10);
                const minutes = parseInt(timeParts[1], 10);
                
                if (isNaN(hours) || isNaN(minutes)) {
                    console.error('時間の変換に失敗:', { hours, minutes });
                    return null;
                }
                
                let hour24 = hours;
                if (!isAM && hours !== 12) hour24 += 12;
                if (isAM && hours === 12) hour24 = 0;
                
                const date = new Date();
                date.setHours(hour24, minutes, 0, 0);
                return date;
            };
            
            const start = parseTime(startTime);
            const end = parseTime(endTime);
            
            if (!start || !end) {
                console.error('時間のパースに失敗:', { startTime, endTime });
                return '';
            }
            
            const diffMs = end - start;
            
            if (diffMs < 0) {
                console.log('負の時間差（日をまたぐ可能性）:', diffMs);
                return ''; // 不正な時間
            }
            
            const diffMinutes = Math.floor(diffMs / (1000 * 60));
            const hours = Math.floor(diffMinutes / 60);
            const minutes = diffMinutes % 60;
            
            if (hours > 0) {
                return `${hours}時間${minutes > 0 ? minutes + '分' : ''}`;
            } else {
                return `${minutes}分`;
            }
        } catch (error) {
            console.error('時間計算エラー:', error, { startTime, endTime });
            return '';
        }
    }

    calculateTotalWorkTime() {
        // 休憩時間を除外して作業時間のみを計算
        const totalMinutes = this.tasks.reduce((total, task) => {
            if (task.endTime && task.startTime && !task.isBreak) {
                const duration = this.calculateDuration(task.startTime, task.endTime);
                if (!duration) return total;
                
                // "1時間30分" -> 90分に変換
                const hours = duration.match(/(\d+)時間/);
                const minutes = duration.match(/(\d+)分/);
                
                let taskMinutes = 0;
                if (hours) {
                    const hourValue = parseInt(hours[1], 10);
                    if (!isNaN(hourValue)) taskMinutes += hourValue * 60;
                }
                if (minutes) {
                    const minuteValue = parseInt(minutes[1], 10);
                    if (!isNaN(minuteValue)) taskMinutes += minuteValue;
                }
                
                return total + taskMinutes;
            }
            return total;
        }, 0);

        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return `${hours}:${minutes.toString().padStart(2, '0')}`;
    }

    calculateProductivity() {
        // 休憩以外のタスクのみで生産性を計算
        const workTasks = this.tasks.filter(task => !task.isBreak);
        if (workTasks.length === 0) return '-';
        const completedRatio = workTasks.filter(task => task.endTime).length / workTasks.length;
        return `${Math.round(completedRatio * 100)}%`;
    }

    copyTaskToInput(taskName, event) {
        // 右クリックの場合のみコンテキストメニューを無効化
        if (event.type === 'contextmenu') {
            event.preventDefault();
        }
        
        // 休憩タスクの場合はコピーしない
        if (taskName === '休憩' || taskName.includes('休憩')) {
            this.showToast('休憩タスクはコピーできません', 'warning');
            return;
        }
        
        const taskInput = document.getElementById('task-input');
        // 既存の入力内容をクリアしてから新しいタスク名をセット
        taskInput.value = '';
        taskInput.value = taskName;
        taskInput.focus();
        taskInput.select(); // テキストを選択状態にする
        
        this.showToast(`「${taskName}」をタスク入力にコピーしました`);
    }

    showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        const messageElement = document.getElementById('toast-message');
        
        // 既存のタイマーをクリア
        if (this.toastTimer) {
            clearTimeout(this.toastTimer);
            this.toastTimer = null;
        }
        
        // 既に表示されている場合は一度非表示にしてから再表示
        if (toast.classList.contains('show')) {
            toast.classList.remove('show');
            
            // 少し待ってから新しいメッセージを表示
            setTimeout(() => {
                this.displayToast(toast, messageElement, message, type);
            }, 100);
        } else {
            this.displayToast(toast, messageElement, message, type);
        }
    }
    
    displayToast(toast, messageElement, message, type) {
        messageElement.textContent = message;
        
        // タイプに応じて色を変更
        const colors = {
            success: 'var(--success)',
            warning: 'var(--warning)',
            error: 'var(--error)'
        };
        
        toast.style.background = colors[type] || colors.success;
        toast.classList.add('show');
        
        // 新しいタイマーを設定
        this.toastTimer = setTimeout(() => {
            toast.classList.remove('show');
            this.toastTimer = null;
        }, 3000);
    }

    showClearConfirmation() {
        const dialog = document.getElementById('confirm-dialog');
        const title = document.getElementById('confirm-title');
        const message = document.getElementById('confirm-message');
        
        title.textContent = 'すべてのタイムラインデータを削除';
        message.textContent = 'すべてのタイムラインデータ（今日・履歴を含む）が完全に削除されます。この操作は元に戻せません。本当に実行しますか？';
        
        this.pendingAction = 'clearAll';
        dialog.classList.add('show');
    }

    hideConfirmDialog() {
        const dialog = document.getElementById('confirm-dialog');
        dialog.classList.remove('show');
        this.pendingAction = null;
        this.pendingTaskId = null; // クリーンアップ
        this.pendingDate = null; // クリーンアップ
    }


    async clearAllTasks() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/timeline/clear-all`, { method: 'POST' });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.tasks = [];
                    this.currentTaskId = null;
                    this.updateTimeline();
                    this.updateStats();
                    this.updateTaskCounter();
                    this.updateCurrentTask('タスクなし');
                    this.showToast('すべてのタイムラインデータを削除しました');
                    
                    // 履歴データを再読み込み
                    await this.loadHistoryDates();
                } else {
                    this.showToast('タイムラインデータの削除に失敗しました', 'error');
                }
            }
        } catch (error) {
            console.error('タイムラインデータ削除エラー:', error);
            this.showToast('タイムラインデータの削除に失敗しました', 'error');
        }
    }

    editTask(taskId) {
        // タスクIDの比較を柔軟に行う
        const task = this.tasks.find(t => {
            // まず完全一致を試行
            if (t.id === taskId) {
                return true;
            }
            
            // 文字列と数値の混在パターンを処理
            if (typeof t.id === 'string' && typeof taskId === 'number') {
                const match = t.id.match(/\d+/);
                const tIdNum = match ? parseInt(match[0]) : null;
                return tIdNum === taskId;
            }
            
            if (typeof t.id === 'number' && typeof taskId === 'string') {
                const match = taskId.match(/\d+/);
                const taskIdNum = match ? parseInt(match[0]) : null;
                return t.id === taskIdNum;
            }
            
            return false;
        });
        
        if (!task) {
            console.error('今日のタスクが見つかりません:', {
                searchingTaskId: taskId,
                searchingTaskIdType: typeof taskId,
                availableTasks: this.tasks.map(t => ({ id: t.id, type: typeof t.id, name: t.name }))
            });
            this.showToast('タスクが見つかりません', 'error');
            return;
        }

        // 編集ダイアログに値を設定（time inputは24時間形式で設定）
        document.getElementById('edit-task-name').value = task.name;
        document.getElementById('edit-start-time').value = this.convertTo24Hour(task.startTime);
        document.getElementById('edit-end-time').value = task.endTime ? this.convertTo24Hour(task.endTime) : '';

        this.editingTaskId = taskId;
        this.editingDate = null; // 今日のタスクを編集中
        this.showEditDialog();
    }

    async editHistoryTask(dateString, taskId) {
        try {
            // 履歴データを取得
            const response = await fetch(`${this.apiBaseUrl}/api/history/${dateString}`);
            if (!response.ok) {
                this.showToast('履歴データの取得に失敗しました', 'error');
                return;
            }
            
            const result = await response.json();
            if (!result.success || !result.data || !result.data.tasks) {
                this.showToast('履歴データが見つかりません', 'error');
                return;
            }
            
            console.log('履歴データのタスク一覧:', result.data.tasks);
            console.log('探しているタスクID:', taskId, typeof taskId);
            
            // タスクIDの比較を柔軟に行う
            const task = result.data.tasks.find(t => {
                console.log(`比較中: t.id="${t.id}" (${typeof t.id}) vs taskId="${taskId}" (${typeof taskId})`);
                
                // まず完全一致を試行
                if (t.id === taskId) {
                    return true;
                }
                
                // 文字列と数値の混在パターンを処理
                if (typeof t.id === 'string' && typeof taskId === 'number') {
                    const match = t.id.match(/\d+/);
                    const tIdNum = match ? parseInt(match[0]) : null;
                    console.log(`文字列→数値比較: tIdNum=${tIdNum} vs taskId=${taskId}`);
                    return tIdNum === taskId;
                }
                
                if (typeof t.id === 'number' && typeof taskId === 'string') {
                    const match = taskId.match(/\d+/);
                    const taskIdNum = match ? parseInt(match[0]) : null;
                    console.log(`数値→文字列比較: t.id=${t.id} vs taskIdNum=${taskIdNum}`);
                    return t.id === taskIdNum;
                }
                
                return false;
            });
            
            console.log('見つかったタスク:', task);
            
            if (!task) {
                this.showToast('指定されたタスクが見つかりません', 'error');
                return;
            }

            console.log('編集ダイアログに設定する値:');
            console.log('- task.name:', task.name);
            console.log('- task.title:', task.title);
            console.log('- task.startTime:', task.startTime);
            console.log('- task.endTime:', task.endTime);

            // 編集ダイアログに値を設定
            const taskName = task.name || task.title || '';
            const startTime24 = this.convertTo24Hour(task.startTime);
            const endTime24 = task.endTime ? this.convertTo24Hour(task.endTime) : '';
            
            console.log('変換後の値:');
            console.log('- taskName:', taskName);
            console.log('- startTime24:', startTime24);
            console.log('- endTime24:', endTime24);
            
            document.getElementById('edit-task-name').value = taskName;
            document.getElementById('edit-start-time').value = startTime24;
            document.getElementById('edit-end-time').value = endTime24;

            this.editingTaskId = taskId;
            this.editingDate = dateString; // 履歴のタスクを編集中
            
            console.log('編集状態を設定:');
            console.log('- this.editingTaskId:', this.editingTaskId);
            console.log('- this.editingDate:', this.editingDate);
            
            this.showEditDialog();
            console.log('編集ダイアログを表示しました');
        } catch (error) {
            console.error('履歴タスク編集エラー:', error);
            this.showToast('履歴タスクの編集に失敗しました', 'error');
        }
    }

    showEditDialog() {
        const dialog = document.getElementById('edit-dialog');
        dialog.classList.add('show');
    }

    hideEditDialog() {
        const dialog = document.getElementById('edit-dialog');
        dialog.classList.remove('show');
        this.editingTaskId = null;
    }

    async saveTask() {
        const taskName = document.getElementById('edit-task-name').value.trim();
        const startTime24 = document.getElementById('edit-start-time').value.trim();
        const endTime24 = document.getElementById('edit-end-time').value.trim();

        if (!taskName || !startTime24) {
            this.showToast('タスク名と開始時刻は必須です', 'warning');
            return;
        }

        // 24時間形式を12時間形式（午前/午後）に変換
        const startTime = this.convertTo12Hour(startTime24);
        const endTime = endTime24 ? this.convertTo12Hour(endTime24) : '';

        try {
            const taskData = {
                name: taskName,
                startTime: startTime,
                endTime: endTime
            };

            let apiUrl, reloadFunction;
            
            console.log('saveTask - 編集状態確認:');
            console.log('- this.editingDate:', this.editingDate);
            console.log('- this.editingTaskId:', this.editingTaskId);
            
            if (this.editingDate) {
                // 履歴タスクの編集
                apiUrl = `${this.apiBaseUrl}/api/history/${this.editingDate}/tasks/${this.editingTaskId}`;
                reloadFunction = () => this.loadHistoryData(this.editingDate);
                console.log('履歴タスクの編集モード - API URL:', apiUrl);
            } else {
                // 今日のタスクの編集
                apiUrl = `${this.apiBaseUrl}/api/tasks/${this.editingTaskId}`;
                reloadFunction = () => this.loadTasks();
                console.log('今日のタスクの編集モード - API URL:', apiUrl);
            }

            console.log('API request - URL:', apiUrl);
            console.log('API request - データ:', taskData);
            
            const response = await fetch(apiUrl, { 
                method: 'PUT', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify(taskData) 
            });
            
            console.log('API response status:', response.status);
            console.log('API response ok:', response.ok);
            
            if (response.ok) {
                const result = await response.json();
                console.log('API response data:', result);
                
                if (result.success) {
                    console.log('タスク更新成功 - リロード実行中...');
                    await reloadFunction();
                    console.log('リロード完了');
                    
                    this.hideEditDialog();
                    
                    // 調整があった場合は通知
                    if (result.adjustments && result.adjustments.length > 0) {
                        this.showAdjustmentNotification(result.adjustments);
                    } else {
                        this.showToast('タスクを更新しました');
                    }
                } else {
                    console.error('API成功だが結果がfalse:', result);
                    this.showToast('タスクの更新に失敗しました', 'error');
                }
            }
            else {
                console.error('API response not ok:', response.status);
                this.showToast('タスクの更新に失敗しました', 'error');
            }
        } catch (error) {
            console.error('タスク更新エラー:', error);
            this.showToast('タスクの更新に失敗しました', 'error');
        }
    }

    showAdjustmentNotification(adjustments) {
        let message = 'タスクを更新しました。';
        if (adjustments.length > 0) {
            message += '\n\n時間の重複を解消するため、以下のタスクも調整されました:';
            adjustments.forEach(adj => {
                const taskName = this.tasks[adj.taskId]?.name || `タスク${adj.taskId + 1}`;
                const fieldName = adj.field === 'startTime' ? '開始時間' : '終了時間';
                message += `\n• ${taskName}の${fieldName}: ${adj.oldValue} → ${adj.newValue}`;
            });
        }
        
        // より詳細な通知用のダイアログを表示
        this.showDetailedToast(message, 'success', 6000);
    }

    showDetailedToast(message, type = 'success', duration = 4000) {
        const toast = document.getElementById('toast');
        const messageElement = document.getElementById('toast-message');
        
        // 改行を<br>に変換
        messageElement.innerHTML = message.replace(/\n/g, '<br>');
        
        // タイプに応じて色を変更
        const colors = {
            success: 'var(--success)',
            warning: 'var(--warning)',
            error: 'var(--error)'
        };
        
        toast.style.background = colors[type] || colors.success;
        toast.classList.add('show');
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, duration);
    }

    deleteCurrentTask() {
        // タスクIDの比較を柔軟に行う
        const task = this.tasks.find(t => {
            // まず完全一致を試行
            if (t.id === this.editingTaskId) {
                return true;
            }
            
            // 文字列と数値の混在パターンを処理
            if (typeof t.id === 'string' && typeof this.editingTaskId === 'number') {
                const match = t.id.match(/\d+/);
                const taskIdNum = match ? parseInt(match[0]) : null;
                return taskIdNum === this.editingTaskId;
            }
            
            if (typeof t.id === 'number' && typeof this.editingTaskId === 'string') {
                const match = this.editingTaskId.match(/\d+/);
                const editingIdNum = match ? parseInt(match[0]) : null;
                return t.id === editingIdNum;
            }
            
            return false;
        });
        
        if (!task) {
            console.error('削除対象のタスクが見つかりません:', {
                editingTaskId: this.editingTaskId,
                editingTaskIdType: typeof this.editingTaskId,
                availableTasks: this.tasks.map(t => ({ id: t.id, type: typeof t.id, name: t.name }))
            });
            return;
        }

        const dialog = document.getElementById('confirm-dialog');
        const title = document.getElementById('confirm-title');
        const message = document.getElementById('confirm-message');
        
        title.textContent = 'タスクを削除';
        const taskName = task.name || task.title || 'タスク';
        message.textContent = `タスク「${taskName}」を削除しますか？この操作は元に戻せません。`;
        
        // 履歴タスクか今日のタスクかで処理を分ける
        if (this.editingDate) {
            this.pendingAction = 'deleteHistoryTask';
        } else {
            this.pendingAction = 'deleteTask';
        }
        this.pendingTaskId = this.editingTaskId; // IDを保存
        this.pendingDate = this.editingDate; // 日付を保存（履歴タスクの場合）
        this.hideEditDialog();
        dialog.classList.add('show');
    }

    async executeConfirmedAction() {
        if (this.pendingAction === 'clearAll') {
            await this.clearAllTasks();
        } else if (this.pendingAction === 'deleteTask') {
            await this.deleteTask();
        } else if (this.pendingAction === 'deleteHistoryTask') {
            await this.deleteHistoryTask();
        } else if (this.pendingAction === 'deleteReportUrl') {
            await this.executeDeleteReportUrl();
        } else if (this.pendingAction === 'closeReportDialog') {
            this.hideReportDialog();
        } else if (this.pendingAction === 'clearTaskStock') {
            await this.executeClearTaskStock();
        }
        this.hideConfirmDialog();
    }

    async deleteTask() {
        try {
            const taskId = this.pendingTaskId;
            console.log('削除対象タスクID:', taskId); // デバッグ用
            
            if (taskId === null || taskId === undefined) {
                this.showToast('削除対象のタスクが特定できません', 'error');
                return;
            }
            
            const response = await fetch(`${this.apiBaseUrl}/api/tasks/${taskId}`, { method: 'DELETE' });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    await this.loadTasks();
                    this.showToast('タスクを削除しました');
                } else {
                    this.showToast('タスクの削除に失敗しました', 'error');
                }
            }
        } catch (error) {
            console.error('タスク削除エラー:', error);
            this.showToast('タスクの削除に失敗しました', 'error');
        } finally {
            this.pendingTaskId = null; // クリーンアップ
        }
    }
    
    async deleteHistoryTask() {
        try {
            const taskId = this.pendingTaskId;
            const dateString = this.pendingDate;
            console.log('履歴タスク削除開始:', { taskId, dateString });
            
            if (taskId === null || taskId === undefined || !dateString) {
                this.showToast('削除対象のタスクまたは日付が特定できません', 'error');
                return;
            }
            
            const response = await fetch(`${this.apiBaseUrl}/api/history/${dateString}/tasks/${taskId}`, { method: 'DELETE' });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    // 履歴データを再読み込み
                    await this.loadHistoryData(dateString);
                    this.showToast('履歴タスクを削除しました');
                } else {
                    this.showToast('履歴タスクの削除に失敗しました', 'error');
                }
            }
        } catch (error) {
            console.error('履歴タスク削除エラー:', error);
            this.showToast('履歴タスクの削除に失敗しました', 'error');
        } finally {
            this.pendingTaskId = null; // クリーンアップ
            this.pendingDate = null; // クリーンアップ
        }
    }

    async showReportDialog() {
        // 目標ストックを読み込み
        await this.loadGoalStock();
        
        // 目標サマリーを生成
        this.generateGoalSummary();

        // タスクサマリーを生成
        this.generateTaskSummary();

        // 報告先リンクを生成
        await this.generateReportLinks();

        // タブを生成
        await this.generateReportTabs();

        // 元のコンテンツを保存（変更検知用）
        await this.saveOriginalContent();

        // 変更監視を開始
        this.setupContentChangeListeners();

        // 保存ボタンの初期状態を設定
        this.updateSaveButtonState();
        
        // タイムラインコピーボタンの状態を設定
        this.updateTimelineCopyButtonState();
        
        // クリップボードコピーボタンの状態を設定
        this.updateClipboardCopyButtonState();

        // ダイアログを表示
        const dialog = document.getElementById('report-dialog');
        dialog.classList.add('show');
    }

    handleReportClose() {
        if (this.hasUnsavedChanges) {
            this.showUnsavedChangesDialog();
        } else {
            this.hideReportDialog();
        }
    }

    showUnsavedChangesDialog() {
        const dialog = document.getElementById('confirm-dialog');
        const title = document.getElementById('confirm-title');
        const message = document.getElementById('confirm-message');
        
        title.textContent = '変更が保存されていません';
        message.textContent = '報告書に未保存の変更があります。\n変更を破棄してダイアログを閉じますか？';
        
        this.pendingAction = 'closeReportDialog';
        dialog.classList.add('show');
    }

    hideReportDialog() {
        const dialog = document.getElementById('report-dialog');
        dialog.classList.remove('show');
        this.hasUnsavedChanges = false;
        this.originalReportContent = '';
        this.originalTabContents.clear();
    }

    async saveOriginalContent() {
        this.hasUnsavedChanges = false;
        this.originalReportContent = '';
        this.originalTabContents.clear();
        
        // 報告先がない場合の単一テキストエリア
        if (this.reportUrls.length === 0) {
            const textarea = document.getElementById('single-report-content');
            if (textarea) {
                this.originalReportContent = textarea.value;
            }
        } else {
            // タブ別コンテンツを保存
            for (const url of this.reportUrls) {
                const tabId = url.id.toString();
                const content = await this.getTabContent(tabId);
                this.originalTabContents.set(tabId, content);
            }
        }
    }

    setupContentChangeListeners() {
        // 既存のイベントリスナーを削除してから新しいものを追加
        this.removeContentChangeListeners();
        
        // 報告先がない場合の単一テキストエリア
        if (this.reportUrls.length === 0) {
            const textarea = document.getElementById('single-report-content');
            if (textarea) {
                // 既存のリスナーを削除
                textarea.removeEventListener('input', this.checkForChanges);
                // 新しいリスナーを追加
                textarea.addEventListener('input', () => this.checkForChanges());
            }
        } else {
            // タブ別テキストエリア
            for (const url of this.reportUrls) {
                const tabId = url.id.toString();
                const textarea = document.getElementById(`tab-content-${tabId}`);
                if (textarea) {
                    // 既存のリスナーを削除
                    textarea.removeEventListener('input', this.checkForChanges);
                    // 新しいリスナーを追加
                    textarea.addEventListener('input', () => this.checkForChanges());
                }
            }
        }
    }

    removeContentChangeListeners() {
        // 単一テキストエリアのリスナーを削除
        const singleTextarea = document.getElementById('single-report-content');
        if (singleTextarea) {
            singleTextarea.removeEventListener('input', this.checkForChanges);
        }
        
        // タブ別テキストエリアのリスナーを削除
        if (this.reportUrls && this.reportUrls.length > 0) {
            for (const url of this.reportUrls) {
                const tabId = url.id.toString();
                const textarea = document.getElementById(`tab-content-${tabId}`);
                if (textarea) {
                    textarea.removeEventListener('input', this.checkForChanges);
                }
            }
        }
    }

    checkForChanges() {
        let hasChanges = false;
        
        // 報告先がない場合の単一テキストエリア
        if (this.reportUrls.length === 0) {
            const textarea = document.getElementById('single-report-content');
            if (textarea) {
                hasChanges = textarea.value !== this.originalReportContent;
            }
        } else {
            // タブ別コンテンツをチェック
            for (const url of this.reportUrls) {
                const tabId = url.id.toString();
                const textarea = document.getElementById(`tab-content-${tabId}`);
                if (textarea) {
                    const originalContent = this.originalTabContents.get(tabId) || '';
                    if (textarea.value !== originalContent) {
                        hasChanges = true;
                        break;
                    }
                }
            }
        }
        
        this.hasUnsavedChanges = hasChanges;
        this.updateSaveButtonState();
        this.updateClipboardCopyButtonState();
    }

    updateSaveButtonState() {
        const saveButton = document.getElementById('report-save');
        if (saveButton) {
            if (this.hasUnsavedChanges) {
                saveButton.classList.add('active');
                saveButton.disabled = false;
            } else {
                saveButton.classList.remove('active');
                saveButton.disabled = true;
            }
        }
    }

    updateTimelineCopyButtonState() {
        const timelineCopyButton = document.getElementById('copy-timeline-btn');
        if (timelineCopyButton) {
            // 終了していないタスクがあるかチェック
            const hasRunningTasks = this.tasks.some(task => !task.endTime);
            
            if (hasRunningTasks) {
                timelineCopyButton.disabled = true;
                timelineCopyButton.classList.add('disabled');
            } else {
                timelineCopyButton.disabled = false;
                timelineCopyButton.classList.remove('disabled');
            }
        }
    }

    updateClipboardCopyButtonState() {
        const clipboardCopyButton = document.getElementById('report-copy');
        if (clipboardCopyButton) {
            // テキストが保存されているかチェック
            const hasContent = this.checkIfReportHasContent();
            // 未保存の変更があるかチェック
            const hasUnsavedChanges = this.hasUnsavedChanges;
            
            // コンテンツがあり、かつ未保存の変更がない場合のみ有効
            if (hasContent && !hasUnsavedChanges) {
                clipboardCopyButton.disabled = false;
                clipboardCopyButton.classList.remove('disabled');
            } else {
                clipboardCopyButton.disabled = true;
                clipboardCopyButton.classList.add('disabled');
            }
        }
    }

    checkIfReportHasContent() {
        // 報告先がない場合の単一テキストエリア
        if (this.reportUrls.length === 0) {
            const textarea = document.getElementById('single-report-content');
            return textarea && textarea.value.trim() !== '';
        } else {
            // タブ別コンテンツをチェック
            const currentTabTextarea = document.getElementById(`tab-content-${this.currentTabId}`);
            return currentTabTextarea && currentTabTextarea.value.trim() !== '';
        }
    }

    generateGoalSummary() {
        const summaryContainer = document.getElementById('goal-summary');
        
        if (!this.goalStock || this.goalStock.length === 0) {
            summaryContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">目標が設定されていません</p>';
            return;
        }

        let summaryHTML = '';
        this.goalStock.forEach((goal, index) => {
            summaryHTML += `<div style="margin-bottom: 8px;">・${goal.name}</div>`;
        });

        summaryContainer.innerHTML = summaryHTML;
    }

    generateTaskSummary() {
        const summaryContainer = document.getElementById('task-summary');
        
        if (this.tasks.length === 0) {
            summaryContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">今日はまだタスクがありません</p>';
            return;
        }

        // 完了したタスクと実行中のタスクを分ける
        const completedTasks = this.tasks.filter(task => task.endTime);
        const runningTasks = this.tasks.filter(task => !task.endTime);

        let summaryHTML = '';

        // 完了したタスク
        if (completedTasks.length > 0) {
            summaryHTML += '<div style="margin-bottom: 16px;"><strong>✅ 完了したタスク:</strong></div>';
            completedTasks.forEach(task => {
                const duration = this.calculateDuration(task.startTime, task.endTime);
                const timeRange = `${this.formatTime(task.startTime)} - ${this.formatTime(task.endTime)}`;
                
                summaryHTML += `
                    <div class="task-item">
                        <div>
                            <div class="task-item-name">${task.name}</div>
                            <div class="task-item-time">${timeRange}</div>
                        </div>
                        <div class="task-item-duration">${duration}</div>
                    </div>
                `;
            });
        }

        // 実行中のタスク
        if (runningTasks.length > 0) {
            summaryHTML += '<div style="margin: 16px 0 16px 0;"><strong>🔄 実行中のタスク:</strong></div>';
            runningTasks.forEach(task => {
                summaryHTML += `
                    <div class="task-item">
                        <div>
                            <div class="task-item-name">${task.name}</div>
                            <div class="task-item-time">${this.formatTime(task.startTime)} - 実行中</div>
                        </div>
                        <div class="task-item-duration">実行中</div>
                    </div>
                `;
            });
        }

        summaryContainer.innerHTML = summaryHTML;
    }


    async copyReport() {
        const reportContent = document.getElementById('report-content').value;
        
        try {
            await navigator.clipboard.writeText(reportContent);
            this.showToast('報告書をクリップボードにコピーしました');
        } catch (error) {
            console.error('コピーエラー:', error);
            this.showToast('コピーに失敗しました', 'error');
        }
    }

    async generateReportLinks() {
        const linksContainer = document.getElementById('report-links');
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/report-urls`);
            if (response.ok) {
                const result = await response.json();
                if (result.success && result.urls && result.urls.length > 0) {
                    const linksHTML = result.urls.map(url => `
                        <button class="report-link-btn" onclick="app.openReportUrl('${url.url}')">
                            <span class="material-icons">open_in_new</span>
                            ${url.name}
                        </button>
                    `).join('');
                    linksContainer.innerHTML = linksHTML;
                } else {
                    linksContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 16px;">報告先が設定されていません</p>';
                }
            }
        } catch (error) {
            console.error('報告先URL取得エラー:', error);
            linksContainer.innerHTML = '<p style="color: var(--error); text-align: center; padding: 16px;">報告先の読み込みに失敗しました</p>';
        }
    }

    async openReportUrl(url) {
        try {
            const result = await (await fetch(`${this.apiBaseUrl}/api/open-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })).json();
            if (result.success) {
                this.showToast('ブラウザで開きました');
            } else {
                this.showToast('URLを開けませんでした', 'error');
            }
        } catch (error) {
            console.error('URL開きエラー:', error);
            this.showToast('URLを開けませんでした', 'error');
        }
    }

    async generateReportTabs() {
        const tabNavigation = document.getElementById('tab-navigation');
        const tabContent = document.getElementById('tab-content');
        
        try {
            // 報告先URLを取得
            const response = await fetch(`${this.apiBaseUrl}/api/report-urls`);
            if (response.ok) {
                const urlResult = await response.json();
                if (urlResult.success) {
                    this.reportUrls = urlResult.urls || [];
                } else {
                    this.reportUrls = [];
                }
            } else {
                this.reportUrls = [];
            }

            // 報告先がない場合は単一のテキストエリアを表示
            if (this.reportUrls.length === 0) {
                tabNavigation.innerHTML = '';
                
                // 既存の報告書データを読み込み
                let existingContent = '';
                try {
                    const reportResponse = await fetch(`${this.apiBaseUrl}/api/report`);
                    if (reportResponse.ok) {
                        const result = await reportResponse.json();
                        if (result.success) {
                            existingContent = result.content;
                        }
                    }
                } catch (error) {
                    console.error('既存報告書読み込みエラー:', error);
                }
                
                tabContent.innerHTML = `
                    <textarea class="tab-textarea" id="single-report-content" placeholder="今日の作業について詳しく記述してください...&#10;&#10;■ 完了した作業&#10;- &#10;&#10;■ 進行中の作業&#10;- &#10;&#10;■ 明日の予定&#10;- &#10;&#10;■ 課題・連絡事項&#10;- ">${existingContent}</textarea>
                `;
                
                // コンテンツが追加された後に変更監視を設定
                setTimeout(() => {
                    this.setupContentChangeListeners();
                }, 100);
                return;
            }

            // 最初の報告先をデフォルトのアクティブタブに設定
            if (!this.currentTabId || !this.reportUrls.find(url => url.id.toString() === this.currentTabId)) {
                this.currentTabId = this.reportUrls[0].id.toString();
            }

            // タブナビゲーションを生成
            let tabsHTML = '';

            // 報告先ごとのタブ
            this.reportUrls.forEach(url => {
                const isActive = this.currentTabId === url.id.toString();
                tabsHTML += `
                    <button class="tab-button ${isActive ? 'active' : ''}" 
                            onclick="app.switchTab('${url.id}')">
                        ${url.name}
                    </button>
                `;
            });

            // タブパネルを生成
            await this.generateTabPanels();

            tabNavigation.innerHTML = tabsHTML;
        } catch (error) {
            console.error('タブ生成エラー:', error);
            tabNavigation.innerHTML = '<p style="color: var(--error); text-align: center; padding: 16px;">タブの読み込みに失敗しました</p>';
        }
    }

    async generateTabPanels() {
        const tabContent = document.getElementById('tab-content');
        let contentHTML = '';

        // 報告先ごとのパネル
        for (const url of this.reportUrls) {
            const content = await this.getTabContent(url.id.toString());
            const isActive = this.currentTabId === url.id.toString();
            contentHTML += `
                <div class="tab-panel ${isActive ? 'active' : ''}" id="tab-panel-${url.id}">
                    <textarea class="tab-textarea" id="tab-content-${url.id}" placeholder="${url.name}向けの報告内容を記述してください...">${content}</textarea>
                </div>
            `;
        }

        tabContent.innerHTML = contentHTML;
        
        // コンテンツが追加された後に変更監視を設定
        setTimeout(() => {
            this.setupContentChangeListeners();
        }, 100);
    }

    async getTabContent(tabId) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/report-tabs/${tabId}`);
            if (response.ok) {
                const result = await response.json();
                return result.success ? result.content : '';
            }
            return '';
        } catch (error) {
            console.error(`タブ${tabId}の内容取得エラー:`, error);
            return '';
        }
    }

    async switchTab(tabId) {
        // 現在のタブの内容を保存
        await this.saveCurrentTabContent();

        // タブを切り替え
        this.currentTabId = tabId.toString();

        // UI更新
        this.updateTabUI();
    }

    async saveCurrentTabContent() {
        const textarea = document.getElementById(`tab-content-${this.currentTabId}`);
        if (textarea) {
            try {
                await fetch(`${this.apiBaseUrl}/api/report-tabs/${this.currentTabId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: textarea.value }) });
            } catch (error) {
                console.error('タブ内容保存エラー:', error);
            }
        }
    }

    updateTabUI() {
        // タブボタンのアクティブ状態を更新
        document.querySelectorAll('.tab-button').forEach(button => {
            button.classList.remove('active');
        });
        
        const activeButton = document.querySelector(`[onclick="app.switchTab('${this.currentTabId}')"]`);
        if (activeButton) {
            activeButton.classList.add('active');
        }

        // タブパネルの表示を更新
        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.remove('active');
        });
        
        const activePanel = document.getElementById(`tab-panel-${this.currentTabId}`);
        if (activePanel) {
            activePanel.classList.add('active');
        }
        
        // タブ切り替え時にボタン状態を更新
        this.updateClipboardCopyButtonState();
    }

    async saveReport() {
        // 報告先がない場合は単一のテキストエリアから保存
        if (this.reportUrls.length === 0) {
            const textarea = document.getElementById('single-report-content');
            if (textarea) {
                try {
                    const response = await fetch(`${this.apiBaseUrl}/api/report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: textarea.value }) });
                    if (response.ok) {
                        const result = await response.json();
                        if (result.success) {
                            this.showToast('報告書を保存しました');
                            // 保存後に変更フラグをリセット
                            this.hasUnsavedChanges = false;
                            this.updateSaveButtonState();
                            this.updateClipboardCopyButtonState();
                            // 元のコンテンツを更新
                            this.originalReportContent = document.getElementById('single-report-content').value;
                        } else {
                            this.showToast('報告書の保存に失敗しました', 'error');
                        }
                    }
                } catch (error) {
                    console.error('報告書保存エラー:', error);
                    this.showToast('報告書の保存に失敗しました', 'error');
                }
            }
            return;
        }

        // タブの内容を保存
        await this.saveCurrentTabContent();
        
        // 保存後に変更フラグをリセット
        this.hasUnsavedChanges = false;
        this.updateSaveButtonState();
        this.updateClipboardCopyButtonState();
        
        // 元のコンテンツを更新
        for (const url of this.reportUrls) {
            const tabId = url.id.toString();
            const textarea = document.getElementById(`tab-content-${tabId}`);
            if (textarea) {
                this.originalTabContents.set(tabId, textarea.value);
            }
        }
        
        this.showToast('報告書を保存しました');
    }

    async copyReport() {
        // 報告先がない場合は単一のテキストエリアからコピー
        if (this.reportUrls.length === 0) {
            const textarea = document.getElementById('single-report-content');
            if (textarea) {
                try {
                    await navigator.clipboard.writeText(textarea.value);
                    this.showToast('クリップボードにコピーしました');
                } catch (error) {
                    console.error('コピーエラー:', error);
                    this.showToast('コピーに失敗しました', 'error');
                }
            }
            return;
        }

        // 現在のタブの内容をコピー
        const textarea = document.getElementById(`tab-content-${this.currentTabId}`);
        if (textarea) {
            try {
                await navigator.clipboard.writeText(textarea.value);
                this.showToast('クリップボードにコピーしました');
            } catch (error) {
                console.error('コピーエラー:', error);
                this.showToast('コピーに失敗しました', 'error');
            }
        }
    }

    async copyGoals() {
        // 目標ストックを読み込み
        await this.loadGoalStock();
        
        if (!this.goalStock || this.goalStock.length === 0) {
            this.showToast('コピーできる目標がありません', 'warning');
            return;
        }

        // 目標を・目標１、・目標２の形式でコピー
        const goalText = this.goalStock.map((goal, index) => {
            return `・${goal.name}`;
        }).join('\n');

        try {
            await navigator.clipboard.writeText(goalText);
            this.showToast('目標をクリップボードにコピーしました');
        } catch (error) {
            console.error('目標コピーエラー:', error);
            this.showToast('目標のコピーに失敗しました', 'error');
        }
    }

    async openSettingsDialog() {
        // URL一覧を読み込み
        await this.loadReportUrls();

        // 設定を読み込み（ダイアログ表示前に実行）
        await this.loadSettings();

        // ダイアログを表示
        const dialog = document.getElementById('settings-dialog');
        dialog.classList.add('show');
    }

    closeSettingsDialog() {
        const dialog = document.getElementById('settings-dialog');
        dialog.classList.remove('show');
        
        // ホットキーキャプチャを停止
        this.isCapturingHotkey = false;
        this.currentHotkeyTarget = null;
    }
    
    async loadSettings() {
        try {
            const settings = await window.electronAPI.getSettings();
            this.settings = settings;
            
            // UI要素に設定を反映
            const hotkeyToggle = document.getElementById('hotkey-toggle');
            
            if (hotkeyToggle) {
                hotkeyToggle.value = settings.globalHotkey?.toggleWindow || '';
            }
            
        } catch (error) {
            console.error('設定の読み込みエラー:', error);
            this.showToast('設定の読み込みに失敗しました', 'error');
        }
    }
    
    async saveSettings() {
        try {
            const hotkeyToggle = document.getElementById('hotkey-toggle').value;
            
            const settings = {
                ...this.settings,
                globalHotkey: {
                    toggleWindow: hotkeyToggle
                }
            };
            
            const result = await window.electronAPI.saveSettings(settings);
            if (result) {
                this.settings = settings;
                this.showToast('設定を保存しました');
            } else {
                this.showToast('設定の保存に失敗しました', 'error');
            }
        } catch (error) {
            console.error('設定の保存エラー:', error);
            this.showToast('設定の保存に失敗しました', 'error');
        }
    }
    
    startHotkeyCapture(targetId) {
        this.currentHotkeyTarget = targetId;
        this.isCapturingHotkey = true;
        
        const input = document.getElementById(targetId);
        if (input) {
            input.value = '';
            input.placeholder = 'キーの組み合わせを押してください...';
            input.focus();
        }
    }
    
    captureHotkey(event) {
        if (!this.isCapturingHotkey || !this.currentHotkeyTarget) return;
        
        event.preventDefault();
        const modifiers = [];
        if (event.ctrlKey) modifiers.push('Control');
        if (event.altKey) modifiers.push('Alt');
        if (event.shiftKey) modifiers.push('Shift');
        if (event.metaKey) modifiers.push('Super'); // Windowsキー or Commandキー

        let key = event.key;
        
        // 修飾キーのみの場合は何もしない
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
            return;
        }
        
        // キー名をElectronのAccelerator形式に変換
        if (key.length === 1) {
            key = key.toUpperCase();
        } else if (key.startsWith('Arrow')) {
            key = key.replace('Arrow', '');
        } else if (key === ' ') {
            key = 'Space';
        }
        
        const hotkeyString = [...modifiers, key].join('+');
        
        const input = document.getElementById(this.currentHotkeyTarget);
        if (input) {
            input.value = hotkeyString;
            input.placeholder = '';
        }
        
        this.isCapturingHotkey = false;
        this.currentHotkeyTarget = null;
    }
    
    clearHotkey(targetId) {
        const input = document.getElementById(targetId);

        if (input) {
            input.value = '';
        }
    }

    async loadReportUrls() {
        const urlList = document.getElementById('url-list');
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/report-urls`);
            if (response.ok) {
                const result = await response.json();
                if (result.success && result.urls) {
                    const urlsHTML = result.urls.map(url => `
                        <div class="url-item">
                            <span class="url-name">${url.name}</span>
                            <span class="url-address">${url.url}</span>
                            <button class="delete-url-btn" onclick="app.confirmDeleteReportUrl('${url.id}')">
                                <span class="material-icons">delete</span>
                            </button>
                        </div>
                    `).join('');
                    urlList.innerHTML = urlsHTML;
                } else {
                    urlList.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 16px;">報告先が設定されていません</p>';
                }
            }
        } catch (error) {
            console.error('報告先URL取得エラー:', error);
            urlList.innerHTML = '<p style="color: var(--error); text-align: center; padding: 16px;">報告先の読み込みに失敗しました</p>';
        }
    }

    async addReportUrl() {
        const nameInput = document.getElementById('url-name-input');
        const urlInput = document.getElementById('url-address-input');
        
        const name = nameInput.value.trim();
        const url = urlInput.value.trim();

        if (!name || !url) {
            this.showToast('名前とURLを入力してください', 'warning');
            return;
        }

        try {
            const response = await fetch(`${this.apiBaseUrl}/api/report-urls`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, url }) });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    nameInput.value = '';
                    urlInput.value = '';
                    await this.loadReportUrls();
                    this.showToast('報告先を追加しました');
                } else {
                    this.showToast('報告先の追加に失敗しました', 'error');
                }
            }
        } catch (error) {
            console.error('報告先追加エラー:', error);
            this.showToast('報告先の追加に失敗しました', 'error');
        }
    }

    confirmDeleteReportUrl(urlId) {
        const dialog = document.getElementById('confirm-dialog');
        const title = document.getElementById('confirm-title');
        const message = document.getElementById('confirm-message');
        
        title.textContent = '報告先を削除';
        message.textContent = 'この報告先を削除しますか？';
        
        this.pendingAction = 'deleteReportUrl';
        this.pendingUrlId = urlId;
        dialog.classList.add('show');
    }

    async executeDeleteReportUrl() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/report-urls/${this.pendingUrlId}`, { method: 'DELETE' });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    await this.loadReportUrls();
                    this.showToast('報告先を削除しました');
                } else {
                    this.showToast('報告先の削除に失敗しました', 'error');
                }
            }
        } catch (error) {
            console.error('報告先削除エラー:', error);
            this.showToast('報告先の削除に失敗しました', 'error');
        } finally {
            this.pendingUrlId = null;
        }
    }

    showGoalStockDialog() {
        const dialog = document.getElementById('goal-stock-dialog');
        dialog.classList.add('show');
        this.loadGoalStock();
    }

    hideGoalStockDialog() {
        if (this.hasGoalStockChanges) {
            // 変更がある場合は確認ダイアログを表示
            // ここでは簡易的に直接閉じる
            console.log('未保存の変更がありますが、ダイアログを閉じます');
        }
        
        const dialog = document.getElementById('goal-stock-dialog');
        dialog.classList.remove('show');
        this.hasGoalStockChanges = false;
    }

    async loadGoalStock() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/goals`);
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.goalStock = result.goals;
                    this.tempGoalStock = JSON.parse(JSON.stringify(this.goalStock)); // ディープコピー
                    this.renderGoalStock();
                }
            }
        } catch (error) {
            console.error('目標ストック読み込みエラー:', error);
        }
    }

    renderGoalStock() {
        const list = document.getElementById('goal-stock-list');
        list.innerHTML = '';
        
        this.tempGoalStock.forEach((goal, index) => {
            const item = document.createElement('div');
            item.className = 'goal-stock-item';
            item.innerHTML = `
                <input type="text" value="${goal.name}" onchange="app.updateTempGoal(${index}, this.value)">
                <button onclick="app.removeTempGoal(${index})"><span class="material-icons">delete</span></button>
            `;
            list.appendChild(item);
        });
        
        this.updateGoalStockSaveButton();
    }

    addGoalStock() {
        const input = document.getElementById('goal-stock-input');
        const name = input.value.trim();
        if (name) {
            this.tempGoalStock.push({ name });
            input.value = '';
            this.hasGoalStockChanges = true;
            this.renderGoalStock();
        }
    }

    updateTempGoal(index, newName) {
        this.tempGoalStock[index].name = newName;
        this.hasGoalStockChanges = true;
        this.updateGoalStockSaveButton();
    }

    removeTempGoal(index) {
        this.tempGoalStock.splice(index, 1);
        this.hasGoalStockChanges = true;
        this.renderGoalStock();
    }

    updateGoalStockSaveButton() {
        const saveBtn = document.getElementById('save-goal-stock-btn');
        saveBtn.disabled = !this.hasGoalStockChanges;
    }

    async saveGoalStockChanges() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/goals`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goals: this.tempGoalStock }) });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.goalStock = this.tempGoalStock;
                    this.hasGoalStockChanges = false;
                    this.updateGoalStockSaveButton();
                    this.showToast('目標ストックを保存しました');
                }
            }
        } catch (error) {
            console.error('目標ストック保存エラー:', error);
            this.showToast('目標ストックの保存に失敗しました', 'error');
        }
    }

    showTaskStockDialog() {
        const dialog = document.getElementById('task-stock-dialog');
        dialog.classList.add('show');
        this.loadTaskStock();
    }

    hideTaskStockDialog() {
        if (this.hasTaskStockChanges) {
            // 変更がある場合は確認ダイアログを表示
            // ここでは簡易的に直接閉じる
            console.log('未保存の変更がありますが、ダイアログを閉じます');
        }
        
        const dialog = document.getElementById('task-stock-dialog');
        dialog.classList.remove('show');
        this.hasTaskStockChanges = false;
    }

    async loadTaskStock() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/task-stock`);
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.taskStock = result.tasks;
                    this.tempTaskStock = JSON.parse(JSON.stringify(this.taskStock)); // ディープコピー
                    this.renderTaskStock();
                }
            }
        } catch (error) {
            console.error('タスクストック読み込みエラー:', error);
        }
    }

    renderTaskStock() {
        const list = document.getElementById('task-stock-list');
        list.innerHTML = '';
        
        this.tempTaskStock.forEach((task, index) => {
            const item = document.createElement('div');
            item.className = 'task-stock-item';
            item.innerHTML = `
                <input type="text" value="${task.name}" onchange="app.updateTempTask(${index}, this.value)">
                <button onclick="app.removeTempTask(${index})"><span class="material-icons">delete</span></button>
            `;
            list.appendChild(item);
        });
        
        this.updateTaskStockSaveButton();
    }

    addTaskStock() {
        const input = document.getElementById('task-stock-input');
        const name = input.value.trim();
        if (name) {
            this.tempTaskStock.push({ name });
            input.value = '';
            this.hasTaskStockChanges = true;
            this.renderTaskStock();
        }
    }

    updateTempTask(index, newName) {
        this.tempTaskStock[index].name = newName;
        this.hasTaskStockChanges = true;
        this.updateTaskStockSaveButton();
    }

    removeTempTask(index) {
        this.tempTaskStock.splice(index, 1);
        this.hasTaskStockChanges = true;
        this.renderTaskStock();
    }

    updateTaskStockSaveButton() {
        const saveBtn = document.getElementById('save-task-stock-btn');
        saveBtn.disabled = !this.hasTaskStockChanges;
    }

    async saveTaskStockChanges() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/task-stock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tasks: this.tempTaskStock }) });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.taskStock = this.tempTaskStock;
                    this.hasTaskStockChanges = false;
                    this.updateTaskStockSaveButton();
                    this.showToast('タスクストックを保存しました');
                }
            }
        } catch (error) {
            console.error('タスクストック保存エラー:', error);
            this.showToast('タスクストックの保存に失敗しました', 'error');
        }
    }
    
    // 履歴機能
    switchToTodayMode() {
        this.currentMode = 'today';
        this.currentDate = null; // 今日の日付を示す
        
        // UI更新
        document.getElementById('today-btn').classList.add('active');
        document.getElementById('history-btn').classList.remove('active');
        document.getElementById('date-selector').style.display = 'none';
        document.getElementById('current-time').style.display = 'block';
        document.getElementById('create-report-btn').style.display = 'flex';
        document.getElementById('goal-stock-btn').style.display = 'flex';
        document.getElementById('break-btn').style.display = 'flex';
        
        // 今日のタスクを再読み込み
        this.loadTasks();
        
        // 日付表示を更新
        this.updateDateTime();
    }
    
    switchToHistoryMode() {
        this.currentMode = 'history';
        
        // UI更新
        document.getElementById('today-btn').classList.remove('active');
        document.getElementById('history-btn').classList.add('active');
        document.getElementById('date-selector').style.display = 'flex';
        document.getElementById('current-time').style.display = 'none';
        document.getElementById('create-report-btn').style.display = 'none';
        document.getElementById('goal-stock-btn').style.display = 'none';
        document.getElementById('break-btn').style.display = 'none';
        
        // 履歴日付を読み込み
        this.loadHistoryDates();
        
        // 履歴が選択されていない状態のUI
        this.clearHistoryView();
    }
    
    clearHistoryView() {
        const container = document.getElementById('timeline-container');
        container.innerHTML = `
            <div class="timeline-empty">
                <span class="material-icons">history</span>
                <p>日付を選択してください</p>
                <p class="sub-text">カレンダーから閲覧したい日付を選びます</p>
            </div>
        `;
        
        // 統計情報もクリア
        document.getElementById('completed-tasks').textContent = '-';
        document.getElementById('work-time').textContent = '-';
        document.getElementById('productivity').textContent = '-';
        
        // 履歴日付表示をリセット
        document.getElementById('history-date-display').textContent = '日付を選択';
    }
    
    async loadHistoryDates() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/history/dates`);
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.historyDates = result.dates;
                    console.log('履歴日付を読み込みました:', this.historyDates);
                    
                    // カレンダーにマークを付けるなどの処理をここに追加できる
                }
            }
        } catch (error) {
            console.error('履歴日付の読み込みエラー:', error);
        }
    }
    
    onDateSelected(dateString) {
        console.log('onDateSelected - 選択された日付:', dateString);
        
        if (!dateString) {
            console.log('日付が空のため処理を中断');
            return;
        }
        
        // 選択された日付を内部状態に保存
        this.currentDate = dateString;
        this.selectedDate = dateString;
        
        // 履歴データを読み込み
        this.loadHistoryData(dateString);
        
        // 履歴日付表示を更新
        const date = new Date(dateString);
        const displayDate = date.toLocaleDateString('ja-JP', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long'
        });
        document.getElementById('current-date').textContent = displayDate;
    }
    
    async loadHistoryData(dateString) {
        try {
            console.log(`履歴データ読み込み開始: ${dateString}`);
            const response = await fetch(`${this.apiBaseUrl}/api/history/${dateString}`);
            if (response.ok) {
                const result = await response.json();
                if (result.success && result.data) {
                    console.log('履歴データ:', result.data);
                    
                    // 履歴データをタイムラインに表示
                    this.renderHistoryTimeline(result.data);
                    
                    // 統計情報を更新
                    this.updateHistoryStats(result.data.tasks);
                } else {
                    // データがない場合は空の表示
                    this.renderEmptyHistory(dateString);
                }
            }
        } catch (error) {
            console.error('履歴データ読み込みエラー:', error);
        }
    }
    
    renderHistoryTimeline(historyData) {
        const container = document.getElementById('timeline-container');
        const tasks = historyData.tasks || [];
        
        if (tasks.length === 0) {
            this.renderEmptyHistory(historyData.date);
            return;
        }
        
        const timelineHTML = tasks.map(task => {
            const startTime = this.formatTime(task.startTime);
            const endTime = task.endTime ? this.formatTime(task.endTime) : '未完了';
            const duration = task.endTime ? this.calculateDuration(task.startTime, task.endTime) : '';
            const isBreak = task.isBreak || false;
            
            // タスク名を表示用に整形
            let displayName = task.name || task.title || '名称未設定';
            if (isBreak) {
                displayName = '休憩';
            }
            
            return `
                <div class="timeline-item">
                    <div class="timeline-time">${startTime}</div>
                    <div class="timeline-content">
                        <div class="timeline-task">${displayName}</div>
                        ${duration ? `<span class="timeline-duration">${duration}</span>` : ''}
                    </div>
                    <button class="timeline-edit" onclick="app.editHistoryTask('${historyData.date}', '${task.id}')" title="編集">
                        <span class="material-icons">edit</span>
                    </button>
                </div>
            `;
        }).join('');
        
        container.innerHTML = timelineHTML;
    }
    
    renderEmptyHistory(dateString) {
        const container = document.getElementById('timeline-container');
        const date = new Date(dateString);
        const displayDate = date.toLocaleDateString('ja-JP', {
            month: 'long',
            day: 'numeric'
        });
        
        container.innerHTML = `
            <div class="timeline-empty">
                <span class="material-icons">calendar_today</span>
                <p>${displayDate}のデータはありません</p>
            </div>
        `;
        
        // 統計情報もクリア
        document.getElementById('completed-tasks').textContent = '0';
        document.getElementById('work-time').textContent = '0:00';
        document.getElementById('productivity').textContent = '-';
    }
    
    updateHistoryStats(tasks) {
        const completedWorkTasks = tasks.filter(task => task.endTime && !task.isBreak).length;
        
        const totalMinutes = tasks.reduce((total, task) => {
            if (task.endTime && task.startTime && !task.isBreak) {
                const duration = this.calculateDuration(task.startTime, task.endTime);
                if (!duration) return total;
                
                const hours = duration.match(/(\d+)時間/);
                const minutes = duration.match(/(\d+)分/);
                
                let taskMinutes = 0;
                if (hours) taskMinutes += parseInt(hours[1], 10) * 60;
                if (minutes) taskMinutes += parseInt(minutes[1], 10);
                
                return total + taskMinutes;
            }
            return total;
        }, 0);
        
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const totalWorkTime = `${hours}:${minutes.toString().padStart(2, '0')}`;
        
        const workTasks = tasks.filter(task => !task.isBreak);
        const productivity = workTasks.length > 0 ? `${Math.round(completedWorkTasks / workTasks.length * 100)}%` : '-';
        
        document.getElementById('completed-tasks').textContent = completedWorkTasks;
        document.getElementById('work-time').textContent = totalWorkTime;
        document.getElementById('productivity').textContent = productivity;
    }
    
    handleWindowRestored() {
        // 1. タイムラインを再読み込み
        if (this.currentMode === 'today') {
            this.loadTasks();
        } else if (this.currentMode === 'history' && this.currentDate) {
            this.loadHistoryData(this.currentDate);
        }
        
        // 2. 報告書ダイアログが開いている場合は内容を再読み込み
        if (document.getElementById('report-dialog').classList.contains('show')) {
            this.showReportDialog();
        }
        
        // 3. 設定ダイアログが開いている場合は内容を再読み込み
        if (document.getElementById('settings-dialog').classList.contains('show')) {
            this.openSettingsDialog();
        }
        
        // 4. タスク入力欄にフォーカス
        const taskInput = document.getElementById('task-input');
        if (taskInput) {
            taskInput.focus();
        }
        
        console.log('ウィンドウ復元後の再描画処理が完了しました');
    }
}

const app = new NippoApp();
window.app = app; // グローバルスコープにappを公開

// グローバルなエラーハンドリング
window.addEventListener('error', (event) => {
    console.error('レンダラープロセスで未捕捉のエラー:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('レンダラープロセスで未処理のPromise rejection:', event.reason);
});

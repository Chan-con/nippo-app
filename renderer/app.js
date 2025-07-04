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
        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.updateDateTime();
        this.updateTaskCounter();
        this.updateBreakButton(false); // 初期状態は休憩開始ボタン

        // タスク入力フォーカスのイベントリスナーを追加
        window.electronAPI.onFocusTaskInput(() => {
            const taskInput = document.getElementById('task-input');
            taskInput.focus();
        });

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

        // すべてクリア
        document.getElementById('clear-all-btn').addEventListener('click', () => this.showClearConfirmation());

        // 報告書作成
        document.getElementById('create-report-btn').addEventListener('click', () => this.showReportDialog());

        // 設定
        document.getElementById('settings-btn').addEventListener('click', () => this.showSettingsDialog());

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
        document.getElementById('report-copy').addEventListener('click', () => this.copyReport());
        document.getElementById('report-save').addEventListener('click', () => this.saveReport());

        // 設定ダイアログのイベントリスナー
        document.getElementById('settings-close').addEventListener('click', () => this.hideSettingsDialog());
        document.getElementById('settings-cancel').addEventListener('click', () => this.hideSettingsDialog());
        document.getElementById('add-url-btn').addEventListener('click', () => this.addReportUrl());
    }

    updateDateTime() {
        const now = new Date();
        const dateElement = document.getElementById('current-date');
        const timeElement = document.getElementById('current-time');

        const dateStr = now.toLocaleDateString('ja-JP', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long'
        });

        const timeStr = now.toLocaleTimeString('ja-JP', {
            hour: '2-digit',
            minute: '2-digit'
        });

        dateElement.textContent = dateStr;
        timeElement.textContent = timeStr;
    }

    async addTask() {
        const taskInput = document.getElementById('task-input');
        const taskName = taskInput.value.trim();

        if (!taskName) {
            this.showToast('タスク名を入力してください', 'warning');
            return;
        }

        // 現在実行中のタスクがあるかチェック
        const currentRunningTask = this.tasks.find(task => !task.endTime);
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: taskName, isBreak: false }) });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    taskInput.value = '';
                    await this.loadTasks();
                    
                    // 前のタスクが自動終了された場合の通知
                    if (currentRunningTask) {
                        this.showToast(`「${currentRunningTask.name}」を終了し、「${taskName}」を開始しました`);
                    } else {
                        this.showToast(`タスク「${taskName}」を開始しました`);
                    }
                    
                    // 現在のタスクを更新
                    this.currentTaskId = result.taskId;
                    this.updateCurrentTask(taskName);
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
            console.log('タスクデータの読み込みを開始...');
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
                        <div class="timeline-task" onclick="app.copyTaskToInput('${displayName.replace(/'/g, "\\'")}', event)" oncontextmenu="app.copyTaskToInput('${displayName.replace(/'/g, "\\'")}', event)" title="クリックでタスク名をコピー">${displayName}</div>
                        ${duration ? `<span class="timeline-duration">${duration}</span>` : ''}
                        ${isRunning ? `<span class="timeline-duration" style="background: ${isBreak ? 'var(--warning)' : 'var(--accent)'}; color: ${isBreak ? 'var(--bg-primary)' : 'white'};">${isBreak ? '休憩中' : '実行中'}</span>` : ''}
                    </div>
                    <button class="timeline-edit" onclick="app.editTask(${task.id})" title="編集">
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
            } else {
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
        taskInput.value = taskName; // 既存の入力内容をクリアして新しいタスク名をセット
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
        if (this.tasks.length === 0) {
            this.showToast('クリアするタスクがありません', 'warning');
            return;
        }

        const dialog = document.getElementById('confirm-dialog');
        const title = document.getElementById('confirm-title');
        const message = document.getElementById('confirm-message');
        
        title.textContent = 'すべてのタスクをクリア';
        message.textContent = 'すべてのタスクデータが削除されます。この操作は元に戻せません。本当に実行しますか？';
        
        this.pendingAction = 'clearAll';
        dialog.classList.add('show');
    }

    hideConfirmDialog() {
        const dialog = document.getElementById('confirm-dialog');
        dialog.classList.remove('show');
        this.pendingAction = null;
        this.pendingTaskId = null; // クリーンアップ
    }


    async clearAllTasks() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/tasks/clear`, { method: 'POST' });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.tasks = [];
                    this.currentTaskId = null;
                    this.updateTimeline();
                    this.updateStats();
                    this.updateTaskCounter();
                    this.updateCurrentTask('タスクなし');
                    this.showToast('すべてのタスクをクリアしました');
                } else {
                    this.showToast('タスクのクリアに失敗しました', 'error');
                }
            }
        } catch (error) {
            console.error('タスククリアエラー:', error);
            this.showToast('タスクのクリアに失敗しました', 'error');
        }
    }

    editTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) {
            this.showToast('タスクが見つかりません', 'error');
            return;
        }

        // 編集ダイアログに値を設定（time inputは24時間形式で設定）
        document.getElementById('edit-task-name').value = task.name;
        document.getElementById('edit-start-time').value = this.convertTo24Hour(task.startTime);
        document.getElementById('edit-end-time').value = task.endTime ? this.convertTo24Hour(task.endTime) : '';

        this.editingTaskId = taskId;
        this.showEditDialog();
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

            const response = await fetch(`${this.apiBaseUrl}/api/tasks/${this.editingTaskId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(taskData) });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    await this.loadTasks();
                    this.hideEditDialog();
                    
                    // 調整があった場合は通知
                    if (result.adjustments && result.adjustments.length > 0) {
                        this.showAdjustmentNotification(result.adjustments);
                    } else {
                        this.showToast('タスクを更新しました');
                    }
                } else {
                    this.showToast('タスクの更新に失敗しました', 'error');
                }
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
        const task = this.tasks.find(t => t.id === this.editingTaskId);
        if (!task) return;

        const dialog = document.getElementById('confirm-dialog');
        const title = document.getElementById('confirm-title');
        const message = document.getElementById('confirm-message');
        
        title.textContent = 'タスクを削除';
        message.textContent = `タスク「${task.name}」を削除しますか？この操作は元に戻せません。`;
        
        this.pendingAction = 'deleteTask';
        this.pendingTaskId = this.editingTaskId; // IDを保存
        this.hideEditDialog();
        dialog.classList.add('show');
    }

    async executeConfirmedAction() {
        if (this.pendingAction === 'clearAll') {
            await this.clearAllTasks();
        } else if (this.pendingAction === 'deleteTask') {
            await this.deleteTask();
        } else if (this.pendingAction === 'deleteReportUrl') {
            await this.executeDeleteReportUrl();
        } else if (this.pendingAction === 'closeReportDialog') {
            this.hideReportDialog();
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

    async showReportDialog() {
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
        // 報告先がない場合の単一テキストエリア
        if (this.reportUrls.length === 0) {
            const textarea = document.getElementById('single-report-content');
            if (textarea) {
                textarea.addEventListener('input', () => this.checkForChanges());
            }
        } else {
            // タブ別テキストエリア
            for (const url of this.reportUrls) {
                const tabId = url.id.toString();
                const textarea = document.getElementById(`tab-content-${tabId}`);
                if (textarea) {
                    textarea.addEventListener('input', () => this.checkForChanges());
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

    async showSettingsDialog() {
        // URL一覧を読み込み
        await this.loadReportUrls();

        // ダイアログを表示
        const dialog = document.getElementById('settings-dialog');
        dialog.classList.add('show');
    }

    hideSettingsDialog() {
        const dialog = document.getElementById('settings-dialog');
        dialog.classList.remove('show');
    }

    async loadReportUrls() {
        const urlList = document.getElementById('url-list');
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/report-urls`);
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.reportUrls = result.urls || [];
                    
                    if (this.reportUrls.length > 0) {
                        const urlsHTML = this.reportUrls.map(url => `
                            <div class="url-item">
                                <div class="url-info">
                                    <div class="url-name">${url.name}</div>
                                    <div class="url-address">${url.url}</div>
                                </div>
                                <div class="url-actions">
                                    <button onclick="app.deleteReportUrl(${url.id})" class="delete" title="削除">
                                        <span class="material-icons">delete</span>
                                    </button>
                                </div>
                            </div>
                        `).join('');
                        urlList.innerHTML = urlsHTML;
                    } else {
                        urlList.innerHTML = `
                            <div class="url-list-empty">
                                <span class="material-icons">link_off</span>
                                <p>報告先URLが登録されていません</p>
                            </div>
                        `;
                    }
                }
            }
        } catch (error) {
            console.error('報告先URL読み込みエラー:', error);
            urlList.innerHTML = '<p style="color: var(--error); text-align: center; padding: 20px;">読み込みに失敗しました</p>';
        }
    }

    async addReportUrl() {
        const nameInput = document.getElementById('url-name-input');
        const urlInput = document.getElementById('url-input');
        
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
                    this.showToast(`「${name}」を追加しました`);
                } else {
                    this.showToast(result.error || '追加に失敗しました', 'error');
                }
            }
        } catch (error) {
            console.error('報告先URL追加エラー:', error);
            this.showToast('追加に失敗しました', 'error');
        }
    }

    async deleteReportUrl(urlId) {
        // 確認ダイアログを表示
        const url = this.reportUrls.find(u => u.id === urlId);
        if (!url) return;

        const dialog = document.getElementById('confirm-dialog');
        const title = document.getElementById('confirm-title');
        const message = document.getElementById('confirm-message');
        
        title.textContent = '報告先を削除';
        message.textContent = `報告先「${url.name}」を削除しますか？\n関連する報告データも同時に削除されます。この操作は元に戻せません。`;
        
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
                    this.showToast('報告先と関連データを削除しました');
                } else {
                    this.showToast('削除に失敗しました', 'error');
                }
            }
        } catch (error) {
            console.error('報告先URL削除エラー:', error);
            this.showToast('削除に失敗しました', 'error');
        } finally {
            this.pendingUrlId = null;
        }
    }
}

// グローバルにアクセスできるようにする
let app;

// アプリケーション開始
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM読み込み完了 - アプリ初期化を開始');
    
    
    
    console.log('アプリケーションを初期化中...');
    app = new NippoApp();
});
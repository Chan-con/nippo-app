const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

class TaskManager {
    constructor(userDataPath = null) {
        // パッケージ化されたアプリではuserDataPathを使用、開発時は従来のパス
        this.dataDir = userDataPath ? path.join(userDataPath, 'datas') : path.join(__dirname, '..', 'datas');
        this.dataFile = path.join(this.dataDir, 'data.txt');
        this.taskListFile = path.join(this.dataDir, 'task_list.txt');
        this.reportFile = path.join(this.dataDir, 'report.txt');
        this.reportTabsFile = path.join(this.dataDir, 'report_tabs.json');
        this.urlsFile = path.join(this.dataDir, 'report_urls.json');
        
        this.initialized = false;
    }

    async initialize() {
        if (!this.initialized) {
            await this.ensureDataDir();
            this.initialized = true;
            console.log('TaskManager初期化完了 - データディレクトリ:', this.dataDir);
        }
    }

    async ensureDataDir() {
        try {
            console.log('データディレクトリの存在確認と作成を開始します。');
            console.log(`ターゲットディレクトリ: ${this.dataDir}`);
            
            // recursive: true なので、親ディレクトリが存在しない場合も自動で作成されるはず
            await fs.mkdir(this.dataDir, { recursive: true });
            
            console.log('データディレクトリの準備が完了しました。');
            
            // 念のため、書き込みテストを行う
            const testFilePath = path.join(this.dataDir, 'test-write.txt');
            console.log(`書き込みテストファイルパス: ${testFilePath}`);
            await fs.writeFile(testFilePath, 'test');
            await fs.unlink(testFilePath);
            console.log('データディレクトリの書き込みテストに成功しました。');

        } catch (error) {
            console.error('データディレクトリの作成または書き込みで致命的なエラーが発生しました。');
            console.error(`ターゲットディレクトリ: ${this.dataDir}`);
            console.error('エラー詳細:', error);
            console.error('エラースタックトレース:', error.stack);
            // このエラーを呼び出し元にスローして、アプリケーションの起動を停止させる
            throw error;
        }
    }

    getTime() {
        /**現在の時間を取得して12時間表示に変換 */
        const now = new Date();
        const amOrPm = now.getHours() < 12 ? "午前" : "午後";
        
        // 11時の50分以降は次の時間にする
        if (now.getHours() === 11 && now.getMinutes() >= 50 && now.getMinutes() <= 59) {
            now.setMinutes(now.getMinutes() + 10);
            now.setMinutes(0);
        }
        
        // 12時間形式に変換
        let hour12 = now.getHours() % 12;
        if (hour12 === 0) {
            hour12 = 12;
        }
        
        const minute = now.getMinutes();
        return `${amOrPm} ${hour12}:${minute.toString().padStart(2, '0')}`;
    }

    async loadSchedule() {
        /**スケジュールデータを読み込む */
        await this.initialize();
        const tasks = [];
        console.log(`データファイルのパス: ${this.dataFile}`);
        
        try {
            const exists = await fs.access(this.dataFile).then(() => true).catch(() => false);
            console.log(`データファイルの存在: ${exists}`);
            
            if (exists) {
                const content = await fs.readFile(this.dataFile, 'utf-8');
                const lines = content.split('\n');
                
                console.log(`読み込んだ行数: ${lines.length}`);
                if (lines.length > 0) {
                    console.log("ファイル内容:");
                    lines.forEach((line, i) => {
                        try {
                            console.log(`  ${i+1}: ${JSON.stringify(line)}`);
                        } catch (error) {
                            console.log(`  ${i+1}: [絵文字を含む行]`);
                        }
                    });
                }

                let taskData = [];
                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (trimmedLine.includes("~")) {
                        // 時間範囲の行
                        try {
                            const [startTime, endTime] = trimmedLine.split("~", 2);
                            taskData.push(startTime.trim(), endTime.trim());
                        } catch (error) {
                            console.error(`時間行の解析エラー: ${trimmedLine}, エラー: ${error}`);
                            continue;
                        }
                    } else {
                        // タスク名の行
                        if (trimmedLine) {
                            taskData.push(trimmedLine);
                            if (taskData.length >= 3) {
                                try {
                                    // 終了時刻の処理：空文字列、"None"、"none"をnullとして扱う
                                    let endTime = taskData.length > 1 && taskData[1] ? taskData[1].trim() : "";
                                    if (!endTime || endTime.toLowerCase() === "none") {
                                        endTime = null;
                                    }
                                    
                                    // タスク名を処理
                                    let taskName = taskData.length > 2 ? taskData[2] : "";
                                    let isBreak = false;
                                    
                                    // 休憩タスクの判定と名前の正規化
                                    if (taskName.startsWith('[BREAK]')) {
                                        isBreak = true;
                                        taskName = taskName.replace('[BREAK]', '').trim();
                                    } else if (taskName.startsWith('🔴 休憩:')) {
                                        isBreak = true;
                                        taskName = taskName.replace('🔴 休憩:', '').trim();
                                    } else if (taskName.startsWith('🔴 休憩')) {
                                        isBreak = true;
                                        taskName = taskName.replace('🔴 休憩', '').trim();
                                    } else if (taskName === '休憩') {
                                        isBreak = true;
                                    }
                                    
                                    // 空の場合は休憩として設定
                                    if (!taskName && isBreak) {
                                        taskName = '休憩';
                                    }
                                    
                                    const task = {
                                        id: tasks.length,
                                        startTime: taskData.length > 0 ? taskData[0] : "",
                                        endTime: endTime,
                                        name: taskName,
                                        isBreak: isBreak
                                    };
                                    tasks.push(task);
                                    try {
                                        console.log(`パースしたタスク: ${JSON.stringify(task)}`);
                                    } catch (error) {
                                        console.log(`パースしたタスク: [絵文字を含むタスク] ID=${task.id}`);
                                    }
                                    taskData = [];
                                } catch (error) {
                                    console.error(`タスクデータの解析エラー: ${JSON.stringify(taskData)}, エラー: ${error}`);
                                    taskData = [];
                                    continue;
                                }
                            }
                        }
                    }
                }
            } else {
                console.log("データファイルが存在しません");
            }
            
            console.log(`読み込み完了 - タスク数: ${tasks.length}`);
            return tasks;
        } catch (error) {
            console.error(`load_schedule全体のエラー: ${error}`);
            console.error(error.stack);
            return [];
        }
    }

    async saveSchedule(tasks) {
        /**スケジュールデータを保存 */
        await this.initialize();
        try {
            console.log(`saveSchedule開始 - ファイルパス: ${this.dataFile}`);
            let content = '';
            for (const task of tasks) {
                const startTime = task.startTime || '';
                let endTime = task.endTime;
                if (endTime === null || endTime === undefined) {
                    endTime = '';
                }
                let name = task.name || '';
                // 休憩タスクの場合は識別子を追加
                if (task.isBreak) {
                    if (name === '休憩' || name === '') {
                        name = "[BREAK] 休憩";
                    } else {
                        name = `[BREAK] ${name}`;
                    }
                }
                content += `${startTime} ~ ${endTime}\n${name}\n`;
            }
            console.log(`保存する内容長: ${content.length}文字`);
            console.log(`保存するタスク数: ${tasks.length}`);
            
            await fs.writeFile(this.dataFile, content, 'utf-8');
            console.log(`スケジュール保存完了: ${tasks.length}件`);
            
            // 保存後に確認
            const savedContent = await fs.readFile(this.dataFile, 'utf-8');
            console.log(`保存後確認 - ファイルサイズ: ${savedContent.length}文字`);
        } catch (error) {
            console.error(`save_scheduleエラー: ${error}`);
            console.error(`エラータイプ: ${error.constructor.name}`);
            console.error(`エラーコード: ${error.code}`);
            console.error(`エラースタック: ${error.stack}`);
            throw error; // エラーを再スロー
        }
    }

    async addTask(taskName, isBreak = false) {
        /**タスクを追加 */
        await this.initialize();
        try {
            console.log(`add_task開始: name='${taskName}', isBreak=${isBreak}`);
            console.log(`データディレクトリ: ${this.dataDir}`);
            console.log(`データファイル: ${this.dataFile}`);
            
            const tasks = await this.loadSchedule();
            console.log(`既存タスク数: ${tasks.length}`);
            
            const addTime = this.getTime();
            console.log(`現在時刻: ${addTime}`);
            
            // 未終了のタスクがあれば終了時刻を設定
            for (const task of tasks) {
                if (!task.endTime) {
                    try {
                        console.log(`未終了タスクを終了: ${JSON.stringify(task)}`);
                    } catch (error) {
                        console.log(`未終了タスクを終了: [絵文字を含むタスク] ID=${task.id}`);
                    }
                    task.endTime = addTime;
                }
            }
            
            // 新しいタスクを追加
            const newTask = {
                id: tasks.length,
                startTime: addTime,
                endTime: null,
                name: taskName,
                isBreak: isBreak
            };
            tasks.push(newTask);
            try {
                console.log(`新しいタスクを追加: ${JSON.stringify(newTask)}`);
            } catch (error) {
                console.log(`新しいタスクを追加: [絵文字を含むタスク] ID=${newTask.id}`);
            }
            
            console.log(`saveSchedule開始 - タスク数: ${tasks.length}`);
            await this.saveSchedule(tasks);
            console.log("add_task完了");
            return newTask;
        } catch (error) {
            console.error(`add_taskエラー: ${error}`);
            console.error(`エラースタック: ${error.stack}`);
            console.error(`データディレクトリ存在チェック: ${this.dataDir}`);
            
            // ファイル書き込み権限をチェック
            try {
                const testFile = path.join(this.dataDir, 'test.txt');
                await fs.writeFile(testFile, 'test', 'utf-8');
                await fs.unlink(testFile);
                console.log('ファイル書き込み権限: OK');
            } catch (permError) {
                console.error(`ファイル書き込み権限エラー: ${permError}`);
            }
            
            throw error; // エラーを再スローして詳細を上位に伝える
        }
    }

    async endCurrentTask() {
        /**現在のタスクを終了 */
        const tasks = await this.loadSchedule();
        const addTime = this.getTime();
        
        console.log(`終了処理開始 - 現在時刻: ${addTime}`);
        console.log(`読み込んだタスク数: ${tasks.length}`);
        
        // 未終了のタスクを探して終了時刻を設定
        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            console.log(`タスク${i}: ${JSON.stringify(task)}`);
            if (!task.endTime) {
                console.log(`未終了タスクを発見: ${task.name}`);
                task.endTime = addTime;
                await this.saveSchedule(tasks);
                console.log(`タスクを終了しました: ${JSON.stringify(task)}`);
                return task;
            }
        }
        
        console.log("未終了のタスクが見つかりませんでした");
        return null;
    }

    async getTimelineText() {
        /**タイムラインのテキストを取得（コピー用に[BREAK]プレフィックスを除去） */
        try {
            const exists = await fs.access(this.dataFile).then(() => true).catch(() => false);
            if (!exists) {
                return "";
            }
            
            const content = await fs.readFile(this.dataFile, 'utf-8');
            
            // コピー時は[BREAK]プレフィックスを除去
            const lines = content.split('\n');
            const cleanedLines = [];
            for (const line of lines) {
                if (line.startsWith('[BREAK]')) {
                    // [BREAK]プレフィックスを除去
                    const cleanedLine = line.replace('[BREAK]', '').trim();
                    cleanedLines.push(cleanedLine);
                } else {
                    cleanedLines.push(line);
                }
            }
            
            return cleanedLines.join('\n');
        } catch (error) {
            console.error(`getTimelineTextエラー: ${error}`);
            return "";
        }
    }

    async clearAllTasks() {
        /**すべてのタスクをクリア */
        try {
            const exists = await fs.access(this.dataFile).then(() => true).catch(() => false);
            if (exists) {
                await fs.unlink(this.dataFile);
            }
            return true;
        } catch (error) {
            console.error(`タスククリアエラー: ${error}`);
            return false;
        }
    }

    parseTimeToMinutes(timeStr) {
        /**時間文字列を分に変換（比較用） */
        try {
            if (!timeStr) {
                return null;
            }
            
            // "午前 10:30" -> 分に変換
            const isAm = timeStr.includes('午前');
            const timeOnly = timeStr.replace('午前 ', '').replace('午後 ', '').trim();
            
            if (!timeOnly.includes(':')) {
                return null;
            }
                
            const [hours, minutes] = timeOnly.split(':');
            let hour = parseInt(hours);
            const minute = parseInt(minutes);
            
            // 12時間形式を24時間形式に変換
            if (!isAm && hour !== 12) {
                hour += 12;
            } else if (isAm && hour === 12) {
                hour = 0;
            }
                
            return hour * 60 + minute;
        } catch (error) {
            return null;
        }
    }

    minutesToTimeStr(minutes) {
        /**分を時間文字列に変換 */
        try {
            if (minutes === null || minutes === undefined) {
                return "";
            }
            
            const hour = Math.floor(minutes / 60);
            const minute = minutes % 60;
            
            // 24時間形式を12時間形式に変換
            if (hour === 0) {
                return `午前 12:${minute.toString().padStart(2, '0')}`;
            } else if (hour < 12) {
                return `午前 ${hour}:${minute.toString().padStart(2, '0')}`;
            } else if (hour === 12) {
                return `午後 12:${minute.toString().padStart(2, '0')}`;
            } else {
                return `午後 ${hour - 12}:${minute.toString().padStart(2, '0')}`;
            }
        } catch (error) {
            return "";
        }
    }

    adjustConflictingTasks(tasks, editedTaskId, newStartTime, newEndTime) {
        /**時間矛盾を解決するためにタスクを調整 */
        const adjustments = [];
        
        if (editedTaskId < 0 || editedTaskId >= tasks.length) {
            return { tasks, adjustments };
        }
        
        const newStartMinutes = this.parseTimeToMinutes(newStartTime);
        const newEndMinutes = this.parseTimeToMinutes(newEndTime);
        
        if (newStartMinutes === null) {
            return { tasks, adjustments };
        }
        
        // 前のタスクとの矛盾をチェック
        if (editedTaskId > 0) {
            const prevTask = tasks[editedTaskId - 1];
            if (prevTask.endTime) {
                const prevEndMinutes = this.parseTimeToMinutes(prevTask.endTime);
                if (prevEndMinutes && prevEndMinutes > newStartMinutes) {
                    // 前のタスクの終了時間を調整
                    prevTask.endTime = this.minutesToTimeStr(newStartMinutes);
                    adjustments.push({
                        taskId: editedTaskId - 1,
                        field: 'endTime',
                        oldValue: this.minutesToTimeStr(prevEndMinutes),
                        newValue: prevTask.endTime,
                        reason: '次のタスクとの重複を解消'
                    });
                }
            }
        }
        
        // 次のタスクとの矛盾をチェック
        if (newEndMinutes && editedTaskId < tasks.length - 1) {
            const nextTask = tasks[editedTaskId + 1];
            const nextStartMinutes = this.parseTimeToMinutes(nextTask.startTime);
            if (nextStartMinutes && nextStartMinutes < newEndMinutes) {
                // 次のタスクの開始時間を調整
                nextTask.startTime = this.minutesToTimeStr(newEndMinutes);
                adjustments.push({
                    taskId: editedTaskId + 1,
                    field: 'startTime',
                    oldValue: this.minutesToTimeStr(nextStartMinutes),
                    newValue: nextTask.startTime,
                    reason: '前のタスクとの重複を解消'
                });
            }
        }
        
        return { tasks, adjustments };
    }

    async updateTask(taskId, taskName, startTime, endTime) {
        /**タスクを更新 */
        try {
            const tasks = await this.loadSchedule();
            if (taskId >= 0 && taskId < tasks.length) {
                // 既存の休憩フラグを保持
                const isBreak = tasks[taskId].isBreak || false;
                
                // 時間矛盾を調整
                const { tasks: adjustedTasks, adjustments } = this.adjustConflictingTasks(
                    tasks, taskId, startTime, endTime
                );
                
                // 編集対象のタスクを更新
                adjustedTasks[taskId].name = taskName;
                adjustedTasks[taskId].startTime = startTime;
                adjustedTasks[taskId].endTime = endTime && endTime.trim() ? endTime : null;
                adjustedTasks[taskId].isBreak = isBreak;
                
                await this.saveSchedule(adjustedTasks);
                
                return {
                    task: adjustedTasks[taskId],
                    adjustments: adjustments
                };
            }
            return null;
        } catch (error) {
            console.error(`タスク更新エラー: ${error}`);
            console.error(error.stack);
            return null;
        }
    }

    async deleteTask(taskId) {
        /**タスクを削除 */
        try {
            const tasks = await this.loadSchedule();
            if (taskId >= 0 && taskId < tasks.length) {
                const deletedTask = tasks.splice(taskId, 1)[0];
                // IDを再振り
                tasks.forEach((task, i) => {
                    task.id = i;
                });
                await this.saveSchedule(tasks);
                return deletedTask;
            }
            return null;
        } catch (error) {
            console.error(`タスク削除エラー: ${error}`);
            return null;
        }
    }

    async saveReport(content) {
        /**報告書を保存 */
        try {
            await fs.writeFile(this.reportFile, content, 'utf-8');
            return true;
        } catch (error) {
            console.error(`報告書保存エラー: ${error}`);
            return false;
        }
    }

    async loadReport() {
        /**報告書を読み込み */
        try {
            const exists = await fs.access(this.reportFile).then(() => true).catch(() => false);
            if (exists) {
                return await fs.readFile(this.reportFile, 'utf-8');
            }
            return "";
        } catch (error) {
            console.error(`報告書読み込みエラー: ${error}`);
            return "";
        }
    }

    async saveReportUrls(urls) {
        /**報告先URLリストを保存 */
        try {
            await fs.writeFile(this.urlsFile, JSON.stringify(urls, null, 2), 'utf-8');
            return true;
        } catch (error) {
            console.error(`URL保存エラー: ${error}`);
            return false;
        }
    }

    async loadReportUrls() {
        /**報告先URLリストを読み込み */
        try {
            const exists = await fs.access(this.urlsFile).then(() => true).catch(() => false);
            if (exists) {
                const content = await fs.readFile(this.urlsFile, 'utf-8');
                return JSON.parse(content);
            }
            return [];
        } catch (error) {
            console.error(`URL読み込みエラー: ${error}`);
            return [];
        }
    }

    async addReportUrl(name, url) {
        /**報告先URLを追加 */
        try {
            const urls = await this.loadReportUrls();
            const newUrl = {
                id: urls.length,
                name: name,
                url: url
            };
            urls.push(newUrl);
            if (await this.saveReportUrls(urls)) {
                return newUrl;
            }
            return null;
        } catch (error) {
            console.error(`URL追加エラー: ${error}`);
            return null;
        }
    }

    async deleteReportUrl(urlId) {
        /**報告先URLを削除 */
        try {
            const urls = await this.loadReportUrls();
            if (urlId >= 0 && urlId < urls.length) {
                const deletedUrl = urls.splice(urlId, 1)[0];
                // IDを再振り
                urls.forEach((url, i) => {
                    url.id = i;
                });
                if (await this.saveReportUrls(urls)) {
                    // 関連する報告タブデータも削除
                    await this.cleanupReportTabData(urlId);
                    return deletedUrl;
                }
            }
            return null;
        } catch (error) {
            console.error(`URL削除エラー: ${error}`);
            return null;
        }
    }

    async saveReportTabs(tabData) {
        /**報告先別の報告内容を保存 */
        try {
            await fs.writeFile(this.reportTabsFile, JSON.stringify(tabData, null, 2), 'utf-8');
            return true;
        } catch (error) {
            console.error(`報告タブデータ保存エラー: ${error}`);
            return false;
        }
    }

    async loadReportTabs() {
        /**報告先別の報告内容を読み込み */
        try {
            const exists = await fs.access(this.reportTabsFile).then(() => true).catch(() => false);
            if (exists) {
                const content = await fs.readFile(this.reportTabsFile, 'utf-8');
                return JSON.parse(content);
            }
            return {};
        } catch (error) {
            console.error(`報告タブデータ読み込みエラー: ${error}`);
            return {};
        }
    }

    async saveReportTabContent(urlId, content) {
        /**特定の報告先の報告内容を保存 */
        try {
            const tabData = await this.loadReportTabs();
            tabData[String(urlId)] = content;
            return await this.saveReportTabs(tabData);
        } catch (error) {
            console.error(`報告タブ内容保存エラー: ${error}`);
            return false;
        }
    }

    async getReportTabContent(urlId) {
        /**特定の報告先の報告内容を取得 */
        try {
            const tabData = await this.loadReportTabs();
            return tabData[String(urlId)] || '';
        } catch (error) {
            console.error(`報告タブ内容取得エラー: ${error}`);
            return '';
        }
    }

    async cleanupReportTabData(deletedUrlId) {
        /**削除された報告先の報告データをクリーンアップ */
        try {
            const tabData = await this.loadReportTabs();
            
            // 削除された報告先のデータを削除
            if (String(deletedUrlId) in tabData) {
                delete tabData[String(deletedUrlId)];
            }
            
            // IDの再振りに対応してデータを調整
            const currentUrls = await this.loadReportUrls();
            const newTabData = {};
            
            for (let i = 0; i < currentUrls.length; i++) {
                const url = currentUrls[i];
                const oldId = url.original_id || i; // 元のIDを保持していればそれを使用
                if (String(oldId) in tabData) {
                    newTabData[String(i)] = tabData[String(oldId)];
                } else if (String(i) in tabData) {
                    newTabData[String(i)] = tabData[String(i)];
                }
            }
            
            return await this.saveReportTabs(newTabData);
        } catch (error) {
            console.error(`報告タブデータクリーンアップエラー: ${error}`);
            return false;
        }
    }

    async migrateLegacyReportData() {
        /**既存の単一報告書データを新形式に移行 */
        try {
            // 既存のレポートファイルがあるか確認
            const reportExists = await fs.access(this.reportFile).then(() => true).catch(() => false);
            const tabsExists = await fs.access(this.reportTabsFile).then(() => true).catch(() => false);
            
            if (reportExists && !tabsExists) {
                const legacyContent = await this.loadReport();
                if (legacyContent.trim()) {
                    // デフォルトタブとして保存
                    const tabData = { 'default': legacyContent };
                    if (await this.saveReportTabs(tabData)) {
                        console.log("既存の報告書データを新形式に移行しました");
                        return true;
                    }
                }
            }
            return true;
        } catch (error) {
            console.error(`データ移行エラー: ${error}`);
            return false;
        }
    }
}

// Express app setup
function createApp(taskManagerInstance) {
    const app = express();
    const taskManager = taskManagerInstance;

    app.use(cors());
    app.use(express.json());

    // API endpoints
    app.get('/api/tasks', async (req, res) => {
        try {
            const tasks = await taskManager.loadSchedule();
            console.log(`API - 取得したタスク数: ${tasks.length}`);
            tasks.forEach(task => {
                try {
                    console.log(`API - タスク: ${JSON.stringify(task)}`);
                } catch (error) {
                    console.log(`API - タスク: [絵文字を含むタスク] ID=${task.id}`);
                }
            });
            res.json({ success: true, tasks: tasks });
        } catch (error) {
            console.error(`API - タスク取得エラー: ${error}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/tasks', async (req, res) => {
        try {
            const data = req.body;
            const taskName = (data.name || '').trim();
            const isBreak = data.isBreak || false;
            
            console.log(`API - タスク追加リクエスト: name='${taskName}', isBreak=${isBreak}`);
            
            if (!taskName) {
                return res.status(400).json({ success: false, error: 'タスク名が必要です' });
            }
            
            const newTask = await taskManager.addTask(taskName, isBreak);
            try {
                console.log(`API - 追加されたタスク: ${JSON.stringify(newTask)}`);
            } catch (error) {
                console.log(`API - 追加されたタスク: [絵文字を含むタスク] ID=${newTask ? newTask.id : 'None'}`);
            }
            res.json({
                success: true, 
                task: newTask,
                taskId: newTask.id
            });
        } catch (error) {
            console.error(`API - タスク追加エラー: ${error}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/tasks/end', async (req, res) => {
        try {
            const endedTask = await taskManager.endCurrentTask();
            if (endedTask) {
                res.json({ success: true, task: endedTask });
            } else {
                res.status(400).json({ success: false, error: '終了するタスクがありません' });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/timeline/copy', async (req, res) => {
        try {
            const timelineText = await taskManager.getTimelineText();
            if (timelineText) {
                // Note: このHTTP APIは使用されなくなったが、互換性のため残す
                res.json({ success: true, message: 'タイムラインをコピーしました' });
            } else {
                res.status(400).json({ success: false, error: 'コピーするデータがありません' });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/tasks/clear', async (req, res) => {
        try {
            const success = await taskManager.clearAllTasks();
            if (success) {
                res.json({ success: true, message: 'すべてのタスクをクリアしました' });
            } else {
                res.status(500).json({ success: false, error: 'タスクのクリアに失敗しました' });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.put('/api/tasks/:taskId', async (req, res) => {
        try {
            const taskId = parseInt(req.params.taskId);
            const data = req.body;
            const taskName = (data.name || '').trim();
            const startTime = (data.startTime || '').trim();
            const endTime = (data.endTime || '').trim();
            
            if (!taskName || !startTime) {
                return res.status(400).json({ success: false, error: 'タスク名と開始時刻は必須です' });
            }
            
            const result = await taskManager.updateTask(taskId, taskName, startTime, endTime);
            if (result) {
                const responseData = { success: true, task: result.task };
                if (result.adjustments) {
                    responseData.adjustments = result.adjustments;
                }
                res.json(responseData);
            } else {
                res.status(404).json({ success: false, error: 'タスクが見つかりません' });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.delete('/api/tasks/:taskId', async (req, res) => {
        try {
            const taskId = parseInt(req.params.taskId);
            console.log(`タスク削除リクエスト - ID: ${taskId}`);
            const deletedTask = await taskManager.deleteTask(taskId);
            if (deletedTask) {
                console.log(`タスク削除成功: ${JSON.stringify(deletedTask)}`);
                res.json({ success: true, task: deletedTask });
            } else {
                console.log(`タスクが見つかりません - ID: ${taskId}`);
                res.status(404).json({ success: false, error: 'タスクが見つかりません' });
            }
        } catch (error) {
            console.error(`タスク削除エラー: ${error}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/report', async (req, res) => {
        try {
            const content = await taskManager.loadReport();
            res.json({ success: true, content: content });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/report', async (req, res) => {
        try {
            const data = req.body;
            const content = data.content || '';
            
            const success = await taskManager.saveReport(content);
            if (success) {
                res.json({ success: true, message: '報告書を保存しました' });
            } else {
                res.status(500).json({ success: false, error: '報告書の保存に失敗しました' });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/report-urls', async (req, res) => {
        try {
            const urls = await taskManager.loadReportUrls();
            res.json({ success: true, urls: urls });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/report-urls', async (req, res) => {
        try {
            const data = req.body;
            const name = (data.name || '').trim();
            const url = (data.url || '').trim();
            
            if (!name || !url) {
                return res.status(400).json({ success: false, error: '名前とURLは必須です' });
            }
            
            const newUrl = await taskManager.addReportUrl(name, url);
            if (newUrl) {
                res.json({ success: true, url: newUrl });
            } else {
                res.status(500).json({ success: false, error: 'URLの追加に失敗しました' });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.delete('/api/report-urls/:urlId', async (req, res) => {
        try {
            const urlId = parseInt(req.params.urlId);
            const deletedUrl = await taskManager.deleteReportUrl(urlId);
            if (deletedUrl) {
                res.json({ success: true, url: deletedUrl });
            } else {
                res.status(404).json({ success: false, error: 'URLが見つかりません' });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/report-tabs', async (req, res) => {
        try {
            // データ移行を確認
            await taskManager.migrateLegacyReportData();
            
            const tabData = await taskManager.loadReportTabs();
            res.json({ success: true, tabs: tabData });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/report-tabs/:tabId', async (req, res) => {
        try {
            const tabId = req.params.tabId;
            const content = await taskManager.getReportTabContent(tabId);
            res.json({ success: true, content: content });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/report-tabs/:tabId', async (req, res) => {
        try {
            const tabId = req.params.tabId;
            const data = req.body;
            const content = data.content || '';
            
            const success = await taskManager.saveReportTabContent(tabId, content);
            if (success) {
                res.json({ success: true, message: '報告内容を保存しました' });
            } else {
                res.status(500).json({ success: false, error: '報告内容の保存に失敗しました' });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/open-url', async (req, res) => {
        try {
            const { url } = req.body;
            if (url) {
                const { spawn } = require('child_process');
                const os = require('os');
                const platform = os.platform();
                
                // メインウィンドウの位置を取得
                let windowArgs = [];
                try {
                    const { BrowserWindow } = require('electron');
                    const mainWindow = BrowserWindow.getAllWindows()[0];
                    if (mainWindow) {
                        const bounds = mainWindow.getBounds();
                        // ブラウザウィンドウを少し右にずらして配置
                        const offsetX = bounds.x + 50;
                        const offsetY = bounds.y + 50;
                        windowArgs = [
                            `--window-position=${offsetX},${offsetY}`,
                            `--window-size=1200,800`
                        ];
                    }
                } catch (error) {
                    console.log('ウィンドウ位置の取得に失敗:', error);
                }
                
                let command;
                let args;
                
                if (platform === 'win32') {
                    // Windowsでは複数のChromeパスを試行
                    const chromePaths = [
                        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                        process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
                    ];
                    
                    let chromeFound = false;
                    const fs = require('fs');
                    
                    for (const chromePath of chromePaths) {
                        try {
                            if (fs.existsSync(chromePath)) {
                                const os = require('os');
                                const path = require('path');
                                const userDataDir = path.join(os.homedir(), '.nippo-chrome-profile');
                                
                                // ディレクトリが存在しない場合は作成
                                if (!fs.existsSync(userDataDir)) {
                                    fs.mkdirSync(userDataDir, { recursive: true });
                                }
                                
                                const chromeArgs = [
                                    '--new-window',
                                    '--no-default-browser-check',
                                    '--no-first-run',
                                    '--disable-default-apps',
                                    `--user-data-dir=${userDataDir}`
                                ];
                                chromeArgs.push(...windowArgs);
                                chromeArgs.push(url);
                                
                                spawn(chromePath, chromeArgs, { detached: true, stdio: 'ignore' });
                                chromeFound = true;
                                break;
                            }
                        } catch (error) {
                            continue;
                        }
                    }
                    
                    if (!chromeFound) {
                        // デフォルトブラウザで開く
                        spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
                    }
                } else if (platform === 'darwin') {
                    // Macでは新規ウィンドウでブラウザを開く
                    try {
                        const os = require('os');
                        const path = require('path');
                        const userDataDir = path.join(os.homedir(), '.nippo-chrome-profile');
                        
                        // ディレクトリが存在しない場合は作成
                        if (!fs.existsSync(userDataDir)) {
                            fs.mkdirSync(userDataDir, { recursive: true });
                        }
                        
                        const chromeArgs = [
                            '--new-window',
                            '--no-default-browser-check',
                            '--no-first-run',
                            '--disable-default-apps',
                            `--user-data-dir=${userDataDir}`
                        ];
                        chromeArgs.push(...windowArgs);
                        chromeArgs.push(url);
                        
                        spawn('open', ['-n', '-a', 'Google Chrome', '--args', ...chromeArgs], { detached: true, stdio: 'ignore' });
                    } catch (error) {
                        // フォールバック
                        spawn('open', [url], { detached: true, stdio: 'ignore' });
                    }
                } else {
                    // Linux用（ChromeまたはFirefoxで新規ウィンドウ）
                    try {
                        const os = require('os');
                        const path = require('path');
                        const userDataDir = path.join(os.homedir(), '.nippo-chrome-profile');
                        
                        // ディレクトリが存在しない場合は作成
                        if (!fs.existsSync(userDataDir)) {
                            fs.mkdirSync(userDataDir, { recursive: true });
                        }
                        
                        const chromeArgs = [
                            '--new-window',
                            '--no-default-browser-check',
                            '--no-first-run',
                            '--disable-default-apps',
                            `--user-data-dir=${userDataDir}`
                        ];
                        chromeArgs.push(...windowArgs);
                        chromeArgs.push(url);
                        
                        spawn('google-chrome', chromeArgs, { detached: true, stdio: 'ignore' });
                    } catch (error) {
                        try {
                            const firefoxArgs = ['-new-window'];
                            if (windowArgs.length > 0) {
                                // Firefoxでは位置指定が異なる
                                firefoxArgs.push(`-width=1200`, `-height=800`);
                            }
                            firefoxArgs.push(url);
                            spawn('firefox', firefoxArgs, { detached: true, stdio: 'ignore' });
                        } catch (error) {
                            spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
                        }
                    }
                }
                
                res.json({ success: true });
            } else {
                res.status(400).json({ success: false, error: 'URL is required' });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/health', (req, res) => {
        res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    });

    return { app, taskManager };
}

module.exports = { TaskManager, createApp };
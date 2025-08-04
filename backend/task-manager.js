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
        this.historyDir = path.join(this.dataDir, 'history');
        
        this.initialized = false;
    }

    async initialize() {
        if (!this.initialized) {
            console.log('TaskManager初期化開始...');
            await this.ensureDataDir();
            
            // 日付変更チェックとアーカイブ処理
            await this.checkAndArchivePreviousDay();
            
            // 既存履歴ファイルの混在データ修正（一度だけ実行）
            await this.fixAllMixedDateHistoryFiles();
            
            // 履歴の整合性をチェックして欠落した日付を補完
            try {
                console.log('履歴整合性チェックを実行します...');
                await this.ensureHistoryIntegrity();
                console.log('履歴整合性チェック完了');
            } catch (error) {
                console.error('履歴整合性チェックでエラーが発生しましたが、処理を継続します:', error);
            }
            
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
            await fs.mkdir(this.historyDir, { recursive: true });
            
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

    async checkAndArchivePreviousDay() {
        try {
            const todayFile = path.join(this.dataDir, 'data_today.json');
            const exists = await fs.access(todayFile).then(() => true).catch(() => false);
            
            if (!exists) {
                console.log('data_today.json が存在しないため、アーカイブ処理をスキップします');
                return;
            }

            const content = await fs.readFile(todayFile, 'utf-8');
            const data = JSON.parse(content);
            const fileDate = data.date;
            const todayString = this.getTodayDateString();

            console.log(`ファイル内の日付: ${fileDate}, 今日の日付: ${todayString}`);

            if (fileDate && fileDate !== todayString) {
                console.log(`日付が変更されました。${fileDate} のデータを履歴にアーカイブします`);
                
                // タスクを日付別に分離してアーカイブ
                await this.archiveTasksByDate(data.tasks || [], fileDate);
                
                // 今日のファイルを新しい日付で初期化
                const newTodayData = {
                    date: todayString,
                    tasks: [],
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                await fs.writeFile(todayFile, JSON.stringify(newTodayData, null, 2), 'utf-8');
                console.log(`data_today.json を新しい日付 ${todayString} で初期化完了`);
            } else {
                console.log('日付変更はありません');
            }
        } catch (error) {
            console.error('日付変更チェック・アーカイブ処理でエラーが発生:', error);
        }
    }

    async archiveTasksByDate(tasks, primaryDate) {
        try {
            // タスクを日付別にグループ化
            const tasksByDate = {};
            
            for (const task of tasks) {
                // タスクの日付を決定（taskDate、createdAt、またはプライマリ日付の順で使用）
                let taskDate = primaryDate;
                
                if (task.taskDate) {
                    taskDate = task.taskDate;
                } else if (task.createdAt) {
                    const createdDate = new Date(task.createdAt);
                    // OSのローカル時間（日本時間）で日付を確実に取得
                    // toLocaleDateStringを使用してローカルタイムゾーンでの日付を取得
                    const localDateParts = createdDate.toLocaleDateString('ja-JP', { 
                        year: 'numeric', 
                        month: '2-digit', 
                        day: '2-digit',
                        timeZone: 'Asia/Tokyo' // 明示的に日本時間を指定
                    }).split('/');
                    taskDate = `${localDateParts[0]}-${localDateParts[1]}-${localDateParts[2]}`;
                }
                
                if (!tasksByDate[taskDate]) {
                    tasksByDate[taskDate] = [];
                }
                tasksByDate[taskDate].push(task);
            }
            
            // 各日付のタスクを対応する履歴ファイルに保存
            for (const [date, dateTasks] of Object.entries(tasksByDate)) {
                const historyFile = path.join(this.historyDir, `data_${date}.json`);
                
                // 既存の履歴ファイルがあれば読み込み、なければ新規作成
                let existingData = {
                    date: date,
                    tasks: [],
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                
                try {
                    const existingContent = await fs.readFile(historyFile, 'utf-8');
                    existingData = JSON.parse(existingContent);
                } catch (error) {
                    // ファイルが存在しない場合は新規作成
                    console.log(`新しい履歴ファイルを作成: ${historyFile}`);
                }
                
                // 重複チェックを行いながらタスクをマージ
                const existingTaskIds = new Set(existingData.tasks.map(t => t.id));
                const newTasks = dateTasks.filter(t => !existingTaskIds.has(t.id));
                
                existingData.tasks = [...existingData.tasks, ...newTasks];
                existingData.updatedAt = new Date().toISOString();
                
                await fs.writeFile(historyFile, JSON.stringify(existingData, null, 2), 'utf-8');
                console.log(`履歴ファイルに保存完了: ${historyFile} (${dateTasks.length}件のタスク)`);
            }
        } catch (error) {
            console.error('タスクの日付別アーカイブでエラーが発生:', error);
        }
    }

    async fixAllMixedDateHistoryFiles() {
        try {
            console.log('既存履歴ファイルの日付混在データ修正を開始...');
            
            // historyディレクトリの全ファイルを取得
            if (!await fs.access(this.historyDir).then(() => true).catch(() => false)) {
                console.log('履歴ディレクトリが存在しません');
                return;
            }
            
            const files = await fs.readdir(this.historyDir);
            const historyFiles = files.filter(file => file.startsWith('data_') && file.endsWith('.json'));
            
            for (const filename of historyFiles) {
                const filePath = path.join(this.historyDir, filename);
                const expectedDate = filename.match(/data_(\d{4}-\d{2}-\d{2})\.json/)?.[1];
                
                if (!expectedDate) continue;
                
                try {
                    const content = await fs.readFile(filePath, 'utf-8');
                    const data = JSON.parse(content);
                    
                    if (!data.tasks || data.tasks.length === 0) continue;
                    
                    console.log(`履歴ファイル ${filename} をチェック中... (期待日付: ${expectedDate})`);
                    
                    // 日付別にタスクをグループ化
                    const tasksByDate = {};
                    let hasMixedDates = false;
                    
                    for (const task of data.tasks) {
                        let taskDate = expectedDate;
                        
                        // taskDateがあればそれを使用、なければcreatedAtから日本時間で判定
                        if (task.taskDate) {
                            taskDate = task.taskDate;
                        } else if (task.createdAt) {
                            const createdDate = new Date(task.createdAt);
                            if (!isNaN(createdDate.getTime())) {
                                // OSのローカル時間（日本時間）で日付を確実に取得
                                const localDateParts = createdDate.toLocaleDateString('ja-JP', { 
                                    year: 'numeric', 
                                    month: '2-digit', 
                                    day: '2-digit',
                                    timeZone: 'Asia/Tokyo' // 明示的に日本時間を指定
                                }).split('/');
                                taskDate = `${localDateParts[0]}-${localDateParts[1]}-${localDateParts[2]}`;
                            }
                        }
                        
                        if (taskDate !== expectedDate) {
                            hasMixedDates = true;
                        }
                        
                        if (!tasksByDate[taskDate]) {
                            tasksByDate[taskDate] = [];
                        }
                        tasksByDate[taskDate].push(task);
                    }
                    
                    if (hasMixedDates) {
                        console.log(`${filename} に混在データを発見。日付別に分離します...`);
                        
                        // 各日付のタスクを対応する履歴ファイルに保存
                        for (const [taskDate, tasks] of Object.entries(tasksByDate)) {
                            const targetFile = path.join(this.historyDir, `data_${taskDate}.json`);
                            
                            let targetData = {
                                date: taskDate,
                                tasks: [],
                                createdAt: new Date().toISOString(),
                                updatedAt: new Date().toISOString()
                            };
                            
                            // 既存ファイルがあれば読み込み
                            try {
                                const existingContent = await fs.readFile(targetFile, 'utf-8');
                                targetData = JSON.parse(existingContent);
                            } catch (error) {
                                // ファイルが存在しない場合は新規作成
                                console.log(`新しい履歴ファイルを作成: ${targetFile}`);
                            }
                            
                            // タスクの重複チェックとマージ
                            const existingIds = new Set(targetData.tasks.map(t => t.id));
                            const newTasks = tasks.filter(t => !existingIds.has(t.id));
                            
                            if (newTasks.length > 0) {
                                targetData.tasks = [...targetData.tasks, ...newTasks];
                                targetData.updatedAt = new Date().toISOString();
                                
                                // ファイルに保存
                                await fs.writeFile(targetFile, JSON.stringify(targetData, null, 2), 'utf-8');
                                console.log(`${taskDate} の履歴ファイルに ${newTasks.length} 件のタスクを追加`);
                            }
                        }
                        
                        console.log(`${filename} の日付混在修正が完了しました`);
                    } else {
                        console.log(`${filename} は日付混在なし`);
                    }
                } catch (error) {
                    console.error(`履歴ファイル ${filename} の処理中にエラー:`, error);
                }
            }
            
            console.log('既存履歴ファイルの日付混在データ修正が完了');
        } catch (error) {
            console.error('履歴ファイル混在修正処理でエラー:', error);
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

    getTodayDateString() {
        /**今日の日付文字列を取得 (YYYY-MM-DD形式) - OSのローカル時間（日本時間）を使用 */
        const today = new Date();
        // OSのローカル時間（日本時間）で日付を確実に取得
        const localDateParts = today.toLocaleDateString('ja-JP', { 
            year: 'numeric', 
            month: '2-digit', 
            day: '2-digit',
            timeZone: 'Asia/Tokyo' // 明示的に日本時間を指定
        }).split('/');
        return `${localDateParts[0]}-${localDateParts[1]}-${localDateParts[2]}`;
    }

    getTodayDataFile() {
        /**今日のデータファイルパスを取得 */
        const dateString = this.getTodayDateString();
        return path.join(this.historyDir, `data_${dateString}.json`);
    }

    getHistoryDataFile(dateString) {
        /**指定日のデータファイルパスを取得 */
        return path.join(this.historyDir, `data_${dateString}.json`);
    }

    getDataFileForDate(dateString = null) {
        /**指定日のデータファイルパス取得（JSON形式統一） */
        if (!dateString) {
            // 今日の場合は特別なファイル名
            return path.join(this.dataDir, 'data_today.json');
        }
        // 過去日付の場合は従来の履歴ファイル形式
        return path.join(this.historyDir, `data_${dateString}.json`);
    }

    async loadSchedule(dateString = null) {
        /**スケジュールデータを読み込む（JSON形式統一） */
        await this.initialize();
        
        // 日付が指定されている場合は履歴から読み込み
        if (dateString) {
            return await this.loadHistoryTasks(dateString);
        }
        
        // 今日のデータを読み込み
        const jsonFile = this.getDataFileForDate();
        console.log(`JSONデータファイルのパス: ${jsonFile}`);
        
        try {
            const exists = await fs.access(jsonFile).then(() => true).catch(() => false);
            console.log(`JSONデータファイルの存在: ${exists}`);
            
            if (exists) {
                const content = await fs.readFile(jsonFile, 'utf-8');
                const data = JSON.parse(content);
                const tasks = data.tasks || [];
                
                // レガシー形式との互換性のため、IDとnameフィールドを調整
                const compatibleTasks = tasks.map((task, index) => ({
                    id: task.id || `task-${index + 1}`, // 既存IDを保持、なければ生成
                    startTime: task.startTime,
                    endTime: task.endTime,
                    name: task.title || task.name,
                    isBreak: task.isBreak || false,
                    tag: task.tag,
                    createdAt: task.createdAt,
                    updatedAt: task.updatedAt
                }));
                
                console.log(`JSON読み込み完了 - タスク数: ${compatibleTasks.length}`);
                return compatibleTasks;
            } else {
                // JSONファイルが存在しない場合、レガシーTXTファイルからの移行を試行
                return await this.migrateFromLegacyFormat();
            }
        } catch (error) {
            console.error(`JSON読み込みエラー: ${error}`);
            // JSONパースエラーの場合もレガシー移行を試行
            return await this.migrateFromLegacyFormat();
        }
    }

    async loadHistoryTasks(dateString) {
        /**履歴タスクを読み込み */
        const historyFile = this.getHistoryDataFile(dateString);
        
        try {
            const exists = await fs.access(historyFile).then(() => true).catch(() => false);
            if (!exists) {
                return [];
            }
            
            const content = await fs.readFile(historyFile, 'utf-8');
            const data = JSON.parse(content);
            const tasks = data.tasks || [];
            
            // レガシー形式との互換性のため、IDとnameフィールドを調整
            const compatibleTasks = tasks.map((task, index) => ({
                id: task.id || `task-${index + 1}`, // 既存IDを保持、なければ生成
                startTime: task.startTime,
                endTime: task.endTime,
                name: task.title || task.name,
                isBreak: task.isBreak || false,
                tag: task.tag,
                createdAt: task.createdAt,
                updatedAt: task.updatedAt
            }));
            
            console.log(`履歴読み込み完了 - 日付: ${dateString}, タスク数: ${compatibleTasks.length}`);
            return compatibleTasks;
        } catch (error) {
            console.error(`履歴読み込みエラー: ${error}`);
            return [];
        }
    }

    async saveSchedule(tasks, dateString = null) {
        /**スケジュールデータを保存（JSON形式統一） */
        await this.initialize();
        
        try {
            const dataFile = this.getDataFileForDate(dateString);
            console.log(`saveSchedule開始 - ファイルパス: ${dataFile}`);
            
            // JSON形式でデータを構築
            const jsonData = {
                date: dateString || this.getTodayDateString(),
                tasks: tasks.map((task, index) => {
                    return {
                        id: task.id !== undefined ? task.id : `task-${index + 1}`, // 既存IDを保持
                        startTime: task.startTime || '',
                        endTime: task.endTime || null,
                        title: task.name || task.title || '',
                        isBreak: task.isBreak || false,
                        tag: task.tag || null,
                        createdAt: task.createdAt || new Date().toISOString(), // 既存作成日時を保持
                        updatedAt: new Date().toISOString() // 更新日時のみ新しく設定
                    };
                }),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            
            console.log(`保存するタスク数: ${tasks.length}`);
            
            await fs.writeFile(dataFile, JSON.stringify(jsonData, null, 2), 'utf-8');
            console.log(`スケジュール保存完了: ${tasks.length}件`);
            
        } catch (error) {
            console.error(`save_scheduleエラー: ${error}`);
            console.error(`エラータイプ: ${error.constructor.name}`);
            console.error(`エラーコード: ${error.code}`);
            console.error(`エラースタック: ${error.stack}`);
            throw error; // エラーを再スロー
        }
    }

    async migrateFromLegacyFormat() {
        /**レガシーTXTファイルからJSONに移行 */
        try {
            console.log('レガシーTXTファイルからの移行を開始...');
            const exists = await fs.access(this.dataFile).then(() => true).catch(() => false);
            
            if (!exists) {
                console.log('レガシーファイルが存在しません - 空のタスクリストを返します');
                return [];
            }
            
            const content = await fs.readFile(this.dataFile, 'utf-8');
            if (!content.trim()) {
                console.log('レガシーファイルが空です');
                return [];
            }
            
            // 既存のconvertTextToJsonメソッドを使用
            const jsonData = await this.convertTextToJson(content);
            
            // JSON形式で今日のファイルとして保存
            const jsonFile = this.getDataFileForDate();
            await fs.writeFile(jsonFile, JSON.stringify(jsonData, null, 2), 'utf-8');
            console.log(`レガシーデータをJSONに移行完了: ${jsonFile}`);
            
            // レガシーファイルをバックアップとして残す
            const backupFile = this.dataFile + '.backup';
            await fs.rename(this.dataFile, backupFile);
            console.log(`レガシーファイルをバックアップ: ${backupFile}`);
            
            // レガシー形式との互換性のため、IDとnameフィールドを調整
            const tasks = jsonData.tasks || [];
            const compatibleTasks = tasks.map((task, index) => ({
                id: index,
                startTime: task.startTime,
                endTime: task.endTime,
                name: task.title || task.name,
                isBreak: task.isBreak || false
            }));
            
            console.log(`移行完了 - タスク数: ${compatibleTasks.length}`);
            return compatibleTasks;
            
        } catch (error) {
            console.error(`レガシー移行エラー: ${error}`);
            return [];
        }
    }

    async addTask(taskName, isBreak = false, dateString = null, tag = null, startTime = null) {
        /**タスクを追加 */
        await this.initialize();
        try {
            console.log(`add_task開始: name='${taskName}', isBreak=${isBreak}, dateString=${dateString}, tag=${tag}, startTime=${startTime}`);
            
            const tasks = await this.loadSchedule(dateString);
            console.log(`既存タスク数: ${tasks.length}`);
            
            // 開始時刻を決定：指定された時刻があればそれを使用、なければ現在時刻
            const addTime = startTime || this.getTimeForDate(dateString);
            console.log(`使用する開始時刻: ${addTime} (指定時刻: ${startTime}, 現在時刻: ${startTime ? 'スキップ' : this.getTimeForDate(dateString)})`);
            
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
            const now = new Date();
            const taskDate = dateString || this.getTodayDateString();
            const newTask = {
                id: `task-${tasks.length + 1}`, // 一貫した文字列ID形式
                startTime: addTime,
                endTime: '',
                name: taskName,
                isBreak: isBreak,
                tag: tag || '',
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
                taskDate: taskDate // タスクが属する日付を明示的に記録
            };
            
            tasks.push(newTask);
            try {
                console.log(`新しいタスクを追加: ${JSON.stringify(newTask)}`);
            } catch (error) {
                console.log(`新しいタスクを追加: [絵文字を含むタスク] ID=${newTask.id}`);
            }
            
            console.log(`saveSchedule開始 - タスク数: ${tasks.length}`);
            await this.saveSchedule(tasks, dateString);
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

    getTimeForDate(dateString = null) {
        /**指定日付の現在時刻を取得（日付は指定、時刻は現在時刻） */
        const now = new Date();
        console.log(`getTimeForDate呼び出し - dateString: ${dateString}, 現在時刻: ${now.toISOString()}`);
        
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
        const formattedTime = `${amOrPm} ${hour12}:${minute.toString().padStart(2, '0')}`;
        
        console.log(`生成された時刻: ${formattedTime}`);
        return formattedTime;
    }

    async endCurrentTask(dateString = null) {
        /**現在のタスクを終了 */
        const tasks = await this.loadSchedule(dateString);
        const addTime = this.getTimeForDate(dateString);
        
        console.log(`終了処理開始 - 時刻: ${addTime}, 日付: ${dateString || '今日'}`);
        console.log(`読み込んだタスク数: ${tasks.length}`);
        
        // 未終了のタスクを探して終了時刻を設定
        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            console.log(`タスク${i}: ${JSON.stringify(task)}`);
            if (!task.endTime) {
                console.log(`未終了タスクを発見: ${task.name}`);
                task.endTime = addTime;
                await this.saveSchedule(tasks, dateString);
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

    async convertTextToJson(textContent) {
        /**テキストファイルの内容をJSONに変換 */
        const lines = textContent.split('\n').filter(line => line.trim());
        const tasks = [];
        let currentTask = null;
        let taskId = 1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // 行番号を削除
            const content = line.replace(/^\d+→/, '');
            
            // 時間範囲の行かチェック
            if (content.includes('~')) {
                if (currentTask) {
                    tasks.push(currentTask);
                }
                
                const timeRange = content.trim();
                const [startTimeStr, endTimeStr] = timeRange.split('~').map(s => s.trim());
                
                currentTask = {
                    id: `task-${taskId++}`,
                    startTime: startTimeStr,
                    endTime: endTimeStr || null,
                    title: '',
                    isBreak: false,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
            } else if (currentTask) {
                // タスク名の行
                const isBreak = content.includes('[BREAK]');
                currentTask.title = isBreak ? content.replace('[BREAK]', '').trim() : content;
                currentTask.isBreak = isBreak;
            }
        }

        if (currentTask) {
            tasks.push(currentTask);
        }

        return {
            date: this.getTodayDateString(),
            tasks: tasks,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }

    async archiveCurrentTasks() {
        /**現在のタスクを履歴として保存 */
        try {
            const exists = await fs.access(this.dataFile).then(() => true).catch(() => false);
            if (!exists) {
                return { success: true, message: '保存するタスクがありません' };
            }

            const textContent = await fs.readFile(this.dataFile, 'utf-8');
            if (!textContent.trim()) {
                return { success: true, message: '保存するタスクがありません' };
            }

            const jsonData = await this.convertTextToJson(textContent);
            const todayFile = this.getTodayDataFile();
            
            await fs.writeFile(todayFile, JSON.stringify(jsonData, null, 2), 'utf-8');
            console.log(`タスクを履歴に保存しました: ${todayFile}`);
            
            return { success: true, message: 'タスクを履歴に保存しました' };
        } catch (error) {
            console.error(`タスク履歴保存エラー: ${error}`);
            return { success: false, message: 'タスクの履歴保存に失敗しました' };
        }
    }

    async clearAllTasks() {
        /**すべてのタスクをクリア（履歴保存付き） */
        try {
            // 現在のタスクを履歴に保存
            const archiveResult = await this.archiveCurrentTasks();
            if (!archiveResult.success) {
                return false;
            }

            // 現在のデータファイルを削除
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

    async clearAllTimelineData() {
        /**すべてのタイムラインデータを完全削除（履歴含む） */
        try {
            console.log('すべてのタイムラインデータを削除中...');
            
            // レガシーTXTファイルを削除
            const legacyExists = await fs.access(this.dataFile).then(() => true).catch(() => false);
            if (legacyExists) {
                await fs.unlink(this.dataFile);
                console.log('レガシーTXTファイルを削除しました:', this.dataFile);
            }
            
            // レガシーバックアップファイルも削除
            const backupFile = this.dataFile + '.backup';
            const backupExists = await fs.access(backupFile).then(() => true).catch(() => false);
            if (backupExists) {
                await fs.unlink(backupFile);
                console.log('レガシーバックアップファイルを削除しました:', backupFile);
            }
            
            // 今日のJSONファイルを削除
            const todayJsonFile = this.getDataFileForDate();
            const todayExists = await fs.access(todayJsonFile).then(() => true).catch(() => false);
            if (todayExists) {
                await fs.unlink(todayJsonFile);
                console.log('今日のJSONファイルを削除しました:', todayJsonFile);
            }

            // 履歴ディレクトリ内のすべてのファイルを削除
            const historyExists = await fs.access(this.historyDir).then(() => true).catch(() => false);
            if (historyExists) {
                const files = await fs.readdir(this.historyDir);
                const jsonFiles = files.filter(file => file.endsWith('.json'));
                
                for (const file of jsonFiles) {
                    const filePath = path.join(this.historyDir, file);
                    await fs.unlink(filePath);
                    console.log(`履歴ファイルを削除しました: ${file}`);
                }
                
                console.log(`${jsonFiles.length}個の履歴ファイルを削除しました`);
            }
            
            console.log('すべてのタイムラインデータの削除が完了しました');
            return true;
        } catch (error) {
            console.error(`全タイムラインデータ削除エラー: ${error}`);
            return false;
        }
    }

    async getAllHistoryDates() {
        /**履歴の日付一覧を取得（今日の日付は除外） */
        try {
            console.log('getAllHistoryDates開始');
            await this.initialize();
            console.log('initialize完了 - historyDir:', this.historyDir);
            
            // まず履歴の整合性をチェックして欠落した日付を補完
            await this.ensureHistoryIntegrity();
            
            const files = await fs.readdir(this.historyDir);
            console.log('読み込んだファイル一覧:', files);
            
            // 今日の日付を取得
            const todayString = this.getTodayDateString();
            console.log('今日の日付:', todayString);
            
            const dates = files
                .filter(file => file.startsWith('data_') && file.endsWith('.json'))
                .map(file => file.replace('data_', '').replace('.json', ''))
                .filter(date => date !== todayString) // 今日の日付を除外
                .sort()
                .reverse(); // 新しい日付から並べる
            
            console.log('抽出した日付一覧（今日を除く）:', dates);
            const result = { success: true, dates: dates };
            console.log('getAllHistoryDates結果:', result);
            return result;
        } catch (error) {
            console.error(`履歴日付取得エラー: ${error}`);
            return { success: false, dates: [] };
        }
    }

    async cleanupHistoryByDate(targetDate) {
        /**指定された日付の履歴ファイルから、その日付以外のタスクを除去 */
        try {
            console.log(`履歴クリーンアップ開始: ${targetDate}`);
            await this.initialize();
            
            const historyFile = path.join(this.historyDir, `data_${targetDate}.json`);
            
            // ファイルの存在確認
            try {
                await fs.access(historyFile);
            } catch (error) {
                console.log(`履歴ファイルが存在しません: ${historyFile}`);
                return { success: true, message: 'ファイルが存在しないため、クリーンアップ不要です' };
            }
            
            // ファイルを読み込み
            const content = await fs.readFile(historyFile, 'utf-8');
            const data = JSON.parse(content);
            
            if (!data.tasks || data.tasks.length === 0) {
                console.log('タスクが存在しないため、クリーンアップ不要です');
                return { success: true, message: 'タスクが存在しないため、クリーンアップ不要です' };
            }
            
            console.log(`クリーンアップ前のタスク数: ${data.tasks.length}`);
            console.log('クリーンアップ前のタスク:', data.tasks.map(t => ({
                id: t.id,
                name: t.name || t.title,
                createdAt: t.createdAt,
                startTime: t.startTime
            })));
            
            // 指定された日付のタスクのみを残す
            const targetDateISO = targetDate; // "2025-07-30" 形式
            const filteredTasks = data.tasks.filter(task => {
                if (task.createdAt) {
                    const taskDate = new Date(task.createdAt);
                    // OSのローカル時間（日本時間）で日付を確実に取得
                    const localDateParts = taskDate.toLocaleDateString('ja-JP', { 
                        year: 'numeric', 
                        month: '2-digit', 
                        day: '2-digit',
                        timeZone: 'Asia/Tokyo' // 明示的に日本時間を指定
                    }).split('/');
                    const taskDateISO = `${localDateParts[0]}-${localDateParts[1]}-${localDateParts[2]}`;
                    const isValidTask = taskDateISO === targetDateISO;
                    
                    if (!isValidTask) {
                        console.log(`除外するタスク: ${task.name || task.title} (作成日時: ${task.createdAt}, 期待日付: ${targetDateISO}, 実際日付: ${taskDateISO})`);
                    }
                    
                    return isValidTask;
                }
                
                // createdAtがない場合は残す（安全のため）
                console.log(`createdAtがないタスクは残します: ${task.name || task.title}`);
                return true;
            });
            
            console.log(`クリーンアップ後のタスク数: ${filteredTasks.length}`);
            
            // クリーンアップ結果をファイルに書き戻し
            const cleanedData = {
                ...data,
                tasks: filteredTasks,
                updatedAt: new Date().toISOString()
            };
            
            await fs.writeFile(historyFile, JSON.stringify(cleanedData, null, 2), 'utf-8');
            
            const removedCount = data.tasks.length - filteredTasks.length;
            console.log(`履歴クリーンアップ完了: ${removedCount}件のタスクを除去しました`);
            
            return { 
                success: true, 
                message: `${removedCount}件の不正なタスクを除去しました`,
                originalCount: data.tasks.length,
                cleanedCount: filteredTasks.length,
                removedCount: removedCount
            };
            
        } catch (error) {
            console.error(`履歴クリーンアップエラー: ${error}`);
            return { success: false, message: 'クリーンアップに失敗しました', error: error.message };
        }
    }

    async loadHistoryByDate(dateString) {
        /**指定日の履歴を読み込み */
        try {
            await this.initialize();
            const historyFile = this.getHistoryDataFile(dateString);
            const exists = await fs.access(historyFile).then(() => true).catch(() => false);
            
            if (!exists) {
                return { success: false, message: '指定された日付の履歴が見つかりません' };
            }

            const content = await fs.readFile(historyFile, 'utf-8');
            const data = JSON.parse(content);
            
            return { success: true, data: data };
        } catch (error) {
            console.error(`履歴読み込みエラー: ${error}`);
            return { success: false, message: '履歴の読み込みに失敗しました' };
        }
    }

    async ensureHistoryIntegrity() {
        /**履歴の整合性を確保：欠落した日付の空ファイルを作成 */
        try {
            console.log('履歴整合性チェック開始...');
            
            // 最初の履歴ファイルの日付を取得
            const files = await fs.readdir(this.historyDir);
            const historyFiles = files
                .filter(file => file.startsWith('data_') && file.endsWith('.json'))
                .map(file => file.replace('data_', '').replace('.json', ''))
                .sort();
            
            if (historyFiles.length === 0) {
                console.log('履歴ファイルが存在しないため、整合性チェックをスキップ');
                return;
            }
            
            const startDate = new Date(historyFiles[0]);
            const today = new Date();
            
            // 開始日から昨日まで、1日ずつチェック
            const currentDate = new Date(startDate);
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            
            console.log(`履歴整合性チェック範囲: ${this.formatDateForFilename(currentDate)} ～ ${this.formatDateForFilename(yesterday)}`);
            
            let createdCount = 0;
            
            while (currentDate <= yesterday) {
                const dateString = this.formatDateForFilename(currentDate);
                const historyFile = path.join(this.historyDir, `data_${dateString}.json`);
                
                const fileExists = await fs.access(historyFile).then(() => true).catch(() => false);
                
                if (!fileExists) {
                    console.log(`欠落した履歴ファイルを作成: ${dateString}`);
                    
                    const emptyHistoryData = {
                        date: dateString,
                        tasks: [],
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        note: '自動生成された空の履歴ファイル'
                    };
                    
                    await fs.writeFile(historyFile, JSON.stringify(emptyHistoryData, null, 2), 'utf-8');
                    createdCount++;
                }
                
                currentDate.setDate(currentDate.getDate() + 1);
            }
            
            if (createdCount > 0) {
                console.log(`履歴整合性チェック完了: ${createdCount}件の空履歴ファイルを作成しました`);
            } else {
                console.log('履歴整合性チェック完了: 欠落なし');
            }
            
        } catch (error) {
            console.error('履歴整合性チェックエラー:', error);
        }
    }

    formatDateForFilename(date) {
        /**日付をファイル名用の文字列に変換 (YYYY-MM-DD) */
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    async updateHistoryByDate(dateString, data) {
        /**指定日の履歴を更新 */
        try {
            await this.initialize();
            const historyFile = this.getHistoryDataFile(dateString);
            
            // 更新日時を追加
            data.updatedAt = new Date().toISOString();
            
            await fs.writeFile(historyFile, JSON.stringify(data, null, 2), 'utf-8');
            console.log(`履歴を更新しました: ${historyFile}`);
            
            return { success: true, message: '履歴を更新しました' };
        } catch (error) {
            console.error(`履歴更新エラー: ${error}`);
            return { success: false, message: '履歴の更新に失敗しました' };
        }
    }

    async addTaskToHistory(dateString, taskData) {
        /**指定日の履歴にタスクを追加 */
        try {
            console.log(`addTaskToHistory開始: dateString=${dateString}, taskData=`, taskData);
            await this.initialize();
            
            // 日付形式の検証
            if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
                console.error('無効な日付形式:', dateString);
                return { success: false, message: '無効な日付形式です' };
            }
            
            // タスクデータの検証
            if (!taskData.title || !taskData.startTime) {
                console.error('必須フィールドが不足:', taskData);
                return { success: false, message: 'タスク名と開始時刻は必須です' };
            }
            
            const historyFile = this.getHistoryDataFile(dateString);
            console.log(`履歴ファイルパス: ${historyFile}`);
            
            // 履歴データを読み込み
            const exists = await fs.access(historyFile).then(() => true).catch(() => false);
            let historyData;
            
            if (exists) {
                console.log('既存の履歴ファイルを読み込み中...');
                const content = await fs.readFile(historyFile, 'utf-8');
                historyData = JSON.parse(content);
            } else {
                console.log('新しい履歴ファイルを作成中...');
                // 履歴データが存在しない場合は新規作成
                historyData = {
                    date: dateString,
                    tasks: [],
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
            }
            
            // 新しいタスクを追加
            const newTask = {
                id: `task-${Date.now()}`,
                startTime: taskData.startTime,
                endTime: taskData.endTime || null,
                title: taskData.title,
                isBreak: taskData.isBreak || false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            
            console.log('追加するタスク:', newTask);
            historyData.tasks.push(newTask);
            historyData.updatedAt = new Date().toISOString();
            
            await fs.writeFile(historyFile, JSON.stringify(historyData, null, 2), 'utf-8');
            console.log(`履歴にタスクを追加しました: ${historyFile}`);
            
            return { success: true, message: 'タスクを追加しました', data: historyData };
        } catch (error) {
            console.error(`履歴タスク追加エラー: ${error.message}`, error);
            return { success: false, message: `タスクの追加に失敗しました: ${error.message}` };
        }
    }

    async createNewHistoryForDate(dateString) {
        /**指定日の新しい履歴ファイルを作成 */
        try {
            await this.initialize();
            const historyFile = this.getHistoryDataFile(dateString);
            
            // 既にファイルが存在する場合は何もしない
            const exists = await fs.access(historyFile).then(() => true).catch(() => false);
            if (exists) {
                return { success: false, message: 'この日付のデータは既に存在します' };
            }
            
            // 新しい履歴データを作成
            const newHistoryData = {
                date: dateString,
                tasks: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            
            await fs.writeFile(historyFile, JSON.stringify(newHistoryData, null, 2), 'utf-8');
            console.log(`新しい履歴を作成しました: ${historyFile}`);
            
            return { success: true, message: '新しい履歴を作成しました', data: newHistoryData };
        } catch (error) {
            console.error(`履歴作成エラー: ${error}`);
            return { success: false, message: '履歴の作成に失敗しました' };
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

    async updateTask(taskId, taskName, startTime, endTime, tag = null) {
        /**タスクを更新 */
        try {
            const tasks = await this.loadSchedule();
            
            const taskIndex = tasks.findIndex(task => task.id == taskId);

            if (taskIndex !== -1) {
                // 既存の休憩フラグを保持
                const isBreak = tasks[taskIndex].isBreak || false;
                
                // 時間矛盾を調整
                const { tasks: adjustedTasks, adjustments } = this.adjustConflictingTasks(
                    tasks, taskIndex, startTime, endTime
                );
                
                // 編集対象のタスクを更新
                adjustedTasks[taskIndex].name = taskName;
                adjustedTasks[taskIndex].startTime = startTime;
                adjustedTasks[taskIndex].endTime = endTime && endTime.trim() ? endTime : null;
                adjustedTasks[taskIndex].isBreak = isBreak;
                adjustedTasks[taskIndex].tag = tag;
                adjustedTasks[taskIndex].updatedAt = new Date().toISOString();
                
                await this.saveSchedule(adjustedTasks);
                
                return {
                    task: adjustedTasks[taskIndex],
                    adjustments: adjustments
                };
            }
            console.log(`更新対象のタスクが見つかりません - ID: ${taskId}`);
            return null;
        } catch (error) {
            console.error(`タスク更新エラー: ${error}`);
            console.error(error.stack);
            return null;
        }
    }

    async updateHistoryTask(dateString, taskId, taskName, startTime, endTime, tag = null) {
        /**履歴タスクを更新 */
        try {
            console.log(`履歴タスク更新: ${dateString}, taskId: ${taskId}`);
            
            // 履歴ファイルパスを取得
            const historyFile = this.getDataFileForDate(dateString);
            
            // 履歴データを読み込み
            const historyData = await this.loadHistoryByDate(dateString);
            if (!historyData.success || !historyData.data || !historyData.data.tasks) {
                return { success: false, message: '履歴データが見つかりません' };
            }
            
            const tasks = historyData.data.tasks;
            console.log('履歴タスク一覧:', tasks.map(t => ({ id: t.id, name: t.name || t.title })));
            console.log('探しているタスクID:', taskId, typeof taskId);
            
            // タスクIDの比較を柔軟に行う（文字列/数値の違いを考慮）
            const taskIndex = tasks.findIndex(task => {
                console.log(`比較中: task.id="${task.id}" (${typeof task.id}) vs taskId="${taskId}" (${typeof taskId})`);
                
                // まず完全一致を試行
                if (task.id === taskId) {
                    return true;
                }
                
                // 文字列と数値の混在パターンを処理
                if (typeof task.id === 'string' && typeof taskId === 'number') {
                    const match = task.id.match(/\d+/);
                    const taskIdNum = match ? parseInt(match[0]) : null;
                    console.log(`文字列→数値比較: taskIdNum=${taskIdNum} vs taskId=${taskId}`);
                    return taskIdNum === taskId;
                }
                
                if (typeof task.id === 'number' && typeof taskId === 'string') {
                    const match = taskId.match(/\d+/);
                    const searchIdNum = match ? parseInt(match[0]) : null;
                    console.log(`数値→文字列比較: task.id=${task.id} vs searchIdNum=${searchIdNum}`);
                    return task.id === searchIdNum;
                }
                
                return false;
            });
            
            console.log('見つかったタスクのインデックス:', taskIndex);
            
            if (taskIndex === -1) {
                return { success: false, message: '指定されたタスクが見つかりません' };
            }
            
            // 既存の休憩フラグとIDを保持
            const isBreak = tasks[taskIndex].isBreak || false;
            const originalId = tasks[taskIndex].id;
            
            // タスクを更新
            tasks[taskIndex] = {
                id: originalId,
                name: taskName,
                startTime: startTime,
                endTime: endTime && endTime.trim() ? endTime : null,
                isBreak: isBreak,
                tag: tag,
                createdAt: tasks[taskIndex].createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            
            // 履歴データを保存
            const updatedData = {
                ...historyData.data,
                tasks: tasks
            };
            
            await this.saveSchedule(tasks, dateString);
            
            console.log(`履歴タスク更新完了: ${dateString}, taskId: ${taskId}`);
            
            return {
                success: true,
                task: tasks[taskIndex],
                data: updatedData
            };
        } catch (error) {
            console.error(`履歴タスク更新エラー: ${error}`);
            console.error(error.stack);
            return { success: false, message: '履歴タスクの更新に失敗しました', error: error.message };
        }
    }

    async deleteTask(taskId) {
        /**タスクを削除 */
        try {
            console.log(`deleteTask開始 - taskId: ${taskId} (${typeof taskId})`);
            const tasks = await this.loadSchedule();
            console.log(`削除前のタスク一覧:`, tasks.map(t => ({ id: t.id, name: t.name })));
            
            // タスクIDの比較を柔軟に行う（文字列/数値の違いを考慮）
            const taskIndex = tasks.findIndex(task => {
                // まず完全一致を試行
                if (task.id === taskId) {
                    return true;
                }
                
                // 文字列と数値の混在パターンを処理
                if (typeof task.id === 'string' && typeof taskId === 'number') {
                    const match = task.id.match(/\d+/);
                    const taskIdNum = match ? parseInt(match[0]) : null;
                    return taskIdNum === taskId;
                }
                
                if (typeof task.id === 'number' && typeof taskId === 'string') {
                    const match = taskId.match(/\d+/);
                    const searchIdNum = match ? parseInt(match[0]) : null;
                    return task.id === searchIdNum;
                }
                
                return false;
            });
            
            console.log(`見つかったタスクのインデックス: ${taskIndex}`);
            
            if (taskIndex !== -1) {
                const deletedTask = tasks.splice(taskIndex, 1)[0];
                console.log(`削除されたタスク:`, deletedTask);
                
                // 削除後にJSONファイルに保存（IDの再振りは行わない）
                await this.saveSchedule(tasks);
                console.log(`タスク削除完了`);
                return deletedTask;
            }
            
            console.log(`タスクが見つかりませんでした - ID: ${taskId}`);
            return null;
        } catch (error) {
            console.error(`タスク削除エラー: ${error}`);
            return null;
        }
    }

    async deleteHistoryTask(dateString, taskId) {
        /**履歴タスクを削除 */
        try {
            console.log(`deleteHistoryTask開始 - dateString: ${dateString}, taskId: ${taskId} (${typeof taskId})`);
            
            // 履歴データを読み込み
            const historyData = await this.loadHistoryByDate(dateString);
            if (!historyData.success || !historyData.data || !historyData.data.tasks) {
                return { success: false, message: '履歴データが見つかりません' };
            }
            
            const tasks = historyData.data.tasks;
            console.log('削除前の履歴タスク一覧:', tasks.map(t => ({ id: t.id, name: t.name || t.title })));
            
            // タスクIDの比較を柔軟に行う（文字列/数値の違いを考慮）
            const taskIndex = tasks.findIndex(task => {
                // まず完全一致を試行
                if (task.id === taskId) {
                    return true;
                }
                
                // 文字列と数値の混在パターンを処理
                if (typeof task.id === 'string' && typeof taskId === 'number') {
                    const match = task.id.match(/\d+/);
                    const taskIdNum = match ? parseInt(match[0]) : null;
                    return taskIdNum === taskId;
                }
                
                if (typeof task.id === 'number' && typeof taskId === 'string') {
                    const match = taskId.match(/\d+/);
                    const searchIdNum = match ? parseInt(match[0]) : null;
                    return task.id === searchIdNum;
                }
                
                return false;
            });
            
            console.log(`見つかった履歴タスクのインデックス: ${taskIndex}`);
            
            if (taskIndex !== -1) {
                const deletedTask = tasks.splice(taskIndex, 1)[0];
                console.log(`削除された履歴タスク:`, deletedTask);
                
                // 履歴ファイルに保存
                const historyFile = this.getDataFileForDate(dateString);
                const updatedData = {
                    ...historyData.data,
                    tasks: tasks,
                    updatedAt: new Date().toISOString()
                };
                
                await this.saveSchedule(tasks, dateString);
                console.log(`履歴タスク削除完了`);
                return { success: true, task: deletedTask };
            }
            
            console.log(`履歴タスクが見つかりませんでした - ID: ${taskId}`);
            return { success: false, message: '指定されたタスクが見つかりません' };
        } catch (error) {
            console.error(`履歴タスク削除エラー: ${error}`);
            return { success: false, message: '履歴タスクの削除に失敗しました', error: error.message };
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

    // Goal stock management
    async loadGoalStock() {
        await this.initialize();
        const goalStockFile = path.join(this.dataDir, 'goal_stock.json');
        try {
            const data = await fs.readFile(goalStockFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.log('Goal stock file not found, returning empty array');
            return [];
        }
    }

    async saveGoalStock(goals) {
        await this.initialize();
        const goalStockFile = path.join(this.dataDir, 'goal_stock.json');
        try {
            await fs.writeFile(goalStockFile, JSON.stringify(goals, null, 2));
            console.log('Goal stock saved successfully');
        } catch (error) {
            console.error('Error saving goal stock:', error);
            throw error;
        }
    }

    // Task stock management
    async loadTaskStock() {
        await this.initialize();
        const taskStockFile = path.join(this.dataDir, 'task_stock.json');
        try {
            const data = await fs.readFile(taskStockFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.log('Task stock file not found, returning empty array');
            return [];
        }
    }

    async saveTaskStock(tasks) {
        await this.initialize();
        const taskStockFile = path.join(this.dataDir, 'task_stock.json');
        try {
            await fs.writeFile(taskStockFile, JSON.stringify(tasks, null, 2));
            console.log('Task stock saved successfully');
        } catch (error) {
            console.error('Error saving task stock:', error);
            throw error;
        }
    }

    // Tag stock management
    async loadTagStock() {
        await this.initialize();
        const tagStockFile = path.join(this.dataDir, 'tag_stock.json');
        try {
            const data = await fs.readFile(tagStockFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.log('Tag stock file not found, returning empty array');
            return [];
        }
    }

    async saveTagStock(tags) {
        await this.initialize();
        const tagStockFile = path.join(this.dataDir, 'tag_stock.json');
        try {
            await fs.writeFile(tagStockFile, JSON.stringify(tags, null, 2));
            console.log('Tag stock saved successfully');
        } catch (error) {
            console.error('Error saving tag stock:', error);
            throw error;
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
            const dateString = req.query.dateString || null; // クエリパラメータから日付取得
            const tasks = await taskManager.loadSchedule(dateString);
            console.log(`API - 取得したタスク数: ${tasks.length}, 日付: ${dateString || '今日'}`);
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
            const dateString = data.dateString || null; // 日付パラメータ追加
            const tag = data.tag || null; // タグパラメータ追加
            const startTime = data.startTime || null; // 開始時刻パラメータ追加
            
            console.log(`API - タスク追加リクエスト: name='${taskName}', isBreak=${isBreak}, dateString=${dateString}, tag=${tag}, startTime=${startTime}`);
            
            if (!taskName) {
                return res.status(400).json({ success: false, error: 'タスク名が必要です' });
            }
            
            const newTask = await taskManager.addTask(taskName, isBreak, dateString, tag, startTime);
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

    app.post('/api/timeline/clear-all', async (req, res) => {
        try {
            const success = await taskManager.clearAllTimelineData();
            if (success) {
                res.json({ success: true, message: 'すべてのタイムラインデータを削除しました' });
            } else {
                res.status(500).json({ success: false, error: 'タイムラインデータの削除に失敗しました' });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 履歴関連のAPIエンドポイント
    app.get('/api/history/dates', async (req, res) => {
        try {
            console.log('履歴日付一覧取得リクエストを受信');
            const result = await taskManager.getAllHistoryDates();
            res.json(result);
        } catch (error) {
            console.error('履歴日付取得エラー:', error);
            res.status(500).json({ success: false, message: '履歴日付の取得に失敗しました' });
        }
    });

    app.get('/api/history/:date', async (req, res) => {
        try {
            const dateString = req.params.date;
            console.log(`履歴取得リクエストを受信: ${dateString}`);
            const result = await taskManager.loadHistoryByDate(dateString);
            
            if (result.success) {
                res.json(result);
            } else {
                res.status(404).json(result);
            }
        } catch (error) {
            console.error('履歴取得エラー:', error);
            res.status(500).json({ success: false, message: '履歴の取得に失敗しました' });
        }
    });

    app.post('/api/history/:date', async (req, res) => {
        try {
            const dateString = req.params.date;
            const data = req.body;
            console.log(`履歴更新リクエストを受信: ${dateString}`);
            
            const result = await taskManager.updateHistoryByDate(dateString, data);
            
            if (result.success) {
                res.json(result);
            } else {
                res.status(500).json(result);
            }
        } catch (error) {
            console.error('履歴更新エラー:', error);
            res.status(500).json({ success: false, message: '履歴の更新に失敗しました' });
        }
    });

    app.post('/api/history/:date/create', async (req, res) => {
        try {
            const dateString = req.params.date;
            console.log(`新しい履歴作成リクエストを受信: ${dateString}`);
            
            const result = await taskManager.createNewHistoryForDate(dateString);
            
            if (result.success) {
                res.json(result);
            } else {
                res.status(400).json(result);
            }
        } catch (error) {
            console.error('履歴作成エラー:', error);
            res.status(500).json({ success: false, message: '履歴の作成に失敗しました' });
        }
    });

    app.post('/api/history/:date/tasks', async (req, res) => {
        try {
            const dateString = req.params.date;
            const taskData = req.body;
            console.log(`履歴タスク追加リクエストを受信: ${dateString}`, taskData);
            
            // 日付形式の検証
            if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
                console.error('無効な日付形式:', dateString);
                return res.status(400).json({ 
                    success: false, 
                    message: '無効な日付形式です。YYYY-MM-DD形式で指定してください。' 
                });
            }
            
            const result = await taskManager.addTaskToHistory(dateString, taskData);
            
            if (result.success) {
                res.json(result);
            } else {
                console.error('履歴タスク追加失敗:', result);
                res.status(400).json(result);
            }
        } catch (error) {
            console.error('履歴タスク追加エラー:', error);
            res.status(500).json({ success: false, message: '履歴タスクの追加に失敗しました', error: error.message });
        }
    });

    app.put('/api/history/:date/tasks/:taskId', async (req, res) => {
        try {
            const dateString = req.params.date;
            const taskId = req.params.taskId; // 文字列IDも受け入れる
            const data = req.body;
            const taskName = (data.name || '').trim();
            const startTime = (data.startTime || '').trim();
            const endTime = (data.endTime || '').trim();
            const tag = data.tag || null;
            
            console.log(`履歴タスク更新リクエストを受信: ${dateString}, taskId: ${taskId}`, data);
            
            // 日付形式の検証
            if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
                console.error('無効な日付形式:', dateString);
                return res.status(400).json({ 
                    success: false, 
                    message: '無効な日付形式です。YYYY-MM-DD形式で指定してください。' 
                });
            }
            
            if (!taskName || !startTime) {
                return res.status(400).json({ success: false, error: 'タスク名と開始時刻は必須です' });
            }
            
            const result = await taskManager.updateHistoryTask(dateString, taskId, taskName, startTime, endTime, tag);
            if (result.success) {
                res.json(result);
            } else {
                res.status(400).json(result);
            }
        } catch (error) {
            console.error('履歴タスク更新エラー:', error);
            res.status(500).json({ success: false, message: '履歴タスクの更新に失敗しました', error: error.message });
        }
    });

    app.put('/api/tasks/:taskId', async (req, res) => {
        try {
            const taskId = req.params.taskId; // Keep as string
            const data = req.body;
            const taskName = (data.name || '').trim();
            const startTime = (data.startTime || '').trim();
            const endTime = (data.endTime || '').trim();
            const tag = data.tag || null;
            
            if (!taskName || !startTime) {
                return res.status(400).json({ success: false, error: 'タスク名と開始時刻は必須です' });
            }
            
            const result = await taskManager.updateTask(taskId, taskName, startTime, endTime, tag);
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
            const taskId = req.params.taskId; // 文字列IDも受け入れる
            console.log(`タスク削除リクエスト - ID: ${taskId} (${typeof taskId})`);
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
    
    // 履歴タスク削除のAPIエンドポイント
    app.delete('/api/history/:date/tasks/:taskId', async (req, res) => {
        try {
            const dateString = req.params.date;
            const taskId = req.params.taskId;
            console.log(`履歴タスク削除リクエスト - Date: ${dateString}, ID: ${taskId}`);
            
            const result = await taskManager.deleteHistoryTask(dateString, taskId);
            if (result.success) {
                console.log(`履歴タスク削除成功: ${JSON.stringify(result.task)}`);
                res.json(result);
            } else {
                console.log(`履歴タスクが見つかりません - Date: ${dateString}, ID: ${taskId}`);
                res.status(404).json(result);
            }
        } catch (error) {
            console.error(`履歴タスク削除エラー: ${error}`);
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

    // Goal stock API endpoints
    app.get('/api/goals', async (req, res) => {
        try {
            const goals = await taskManager.loadGoalStock();
            res.json({ success: true, goals: goals });
        } catch (error) {
            console.error('Goal stock load error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/goals', async (req, res) => {
        try {
            const { goals } = req.body;
            await taskManager.saveGoalStock(goals);
            res.json({ success: true, message: 'Goal stock saved successfully' });
        } catch (error) {
            console.error('Goal stock save error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Task stock API endpoints
    app.get('/api/task-stock', async (req, res) => {
        try {
            const tasks = await taskManager.loadTaskStock();
            res.json({ success: true, tasks: tasks });
        } catch (error) {
            console.error('Task stock load error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/task-stock', async (req, res) => {
        try {
            const { tasks } = req.body;
            await taskManager.saveTaskStock(tasks);
            res.json({ success: true, message: 'Task stock saved successfully' });
        } catch (error) {
            console.error('Task stock save error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Tag stock API endpoints
    app.get('/api/tags', async (req, res) => {
        try {
            const tags = await taskManager.loadTagStock();
            res.json({ success: true, tags: tags });
        } catch (error) {
            console.error('Tag stock load error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/tags', async (req, res) => {
        try {
            const { tags } = req.body;
            await taskManager.saveTagStock(tags);
            res.json({ success: true, message: 'Tag stock saved successfully' });
        } catch (error) {
            console.error('Tag stock save error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/health', (req, res) => {
        res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    });

    // 履歴データクリーンアップ API
    app.post('/api/history/cleanup', async (req, res) => {
        try {
            const { targetDate } = req.body;
            const result = await taskManager.cleanupHistoryByDate(targetDate);
            res.json(result);
        } catch (error) {
            console.error('履歴クリーンアップエラー:', error);
            res.status(500).json({ success: false, message: '履歴クリーンアップに失敗しました' });
        }
    });

    return { app, taskManager };
}

module.exports = { TaskManager, createApp };
const path = require('path');
const os = require('os');
const fs = require('fs');
const { TaskManager } = require('../backend/task-manager');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nippo-test-'));
  const tm = new TaskManager(tmp);
  tm.setTimeRoundingConfig({ interval: 0, mode: 'nearest' });
  await tm.initialize();

  // 1. 最初のタスクを追加
  const t1 = await tm.addTask('Task A', false, null, null, '午前 9:00');
  console.log('added1', t1.startTime, t1.endTime, t1.name);

  // 2. 実行中に次のタスクを追加（同時刻）
  const t2 = await tm.addTask('Task B', false, null, null, '午前 9:30');
  console.log('added2', t2.startTime, t2.endTime, t2.name);

  // 3. 現在のタスク終了
  const ended = await tm.endCurrentTask();
  console.log('ended', ended && ended.name, ended && ended.endTime);
})();

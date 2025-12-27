const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onApiPort: (callback) => ipcRenderer.on('set-api-port', (event, port) => callback(port)),
  onFocusTaskInput: (callback) => ipcRenderer.on('focus-task-input', callback),
  onWindowRestored: (callback) => ipcRenderer.on('window-restored', callback),
  onTasksUpdated: (callback) => ipcRenderer.on('tasks-updated', callback),
  getTasks: () => ipcRenderer.invoke('get-tasks'),
  addTask: (taskName) => ipcRenderer.invoke('add-task', taskName),
  endTask: () => ipcRenderer.invoke('end-task'),
  copyTimeline: () => ipcRenderer.invoke('copy-timeline'),
  clearAllTasks: () => ipcRenderer.invoke('clear-all-tasks'),
  updateTask: (taskId, taskData) => ipcRenderer.invoke('update-task', taskId, taskData),
  deleteTask: (taskId) => ipcRenderer.invoke('delete-task', taskId),
  
  getReport: () => ipcRenderer.invoke('get-report'),
  saveReport: (content) => ipcRenderer.invoke('save-report', content),
  getReportUrls: () => ipcRenderer.invoke('get-report-urls'),
  addReportUrl: (name, url) => ipcRenderer.invoke('add-report-url', name, url),
  deleteReportUrl: (urlId) => ipcRenderer.invoke('delete-report-url', urlId),
  
  getReportTabs: () => ipcRenderer.invoke('get-report-tabs'),
  getReportTabContent: (tabId) => ipcRenderer.invoke('get-report-tab-content', tabId),
  saveReportTabContent: (tabId, content) => ipcRenderer.invoke('save-report-tab-content', tabId, content),
  
  // 設定管理
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings)
});
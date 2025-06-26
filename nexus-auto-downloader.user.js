// ==UserScript==
// @name         NexusPHP 智能批量下载器 (修复版)
// @namespace    http://tampermonkey.net/
// @version      1.3.2
// @description  自动识别NexusPHP站点并智能批量下载种子
// @author       Auto Downloader
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_log
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // 配置选项
    const CONFIG = {
        downloadDelay: GM_getValue('downloadDelay', 1000)  // 下载间隔(毫秒)
    };

    // 全局状态
    let downloadQueue = [];
    let currentDownloads = 0;
    let totalProcessed = 0;
    let successCount = 0;
    let failCount = 0;
    let isRunning = false;

    // 日志系统
    const Logger = {
        log: (message, type = 'info') => {
            const timestamp = new Date().toLocaleTimeString();
            const logMessage = `[${timestamp}] [${type.toUpperCase()}] ${message}`;
            console.log(logMessage);
            GM_log(logMessage);
            
            const logContainer = document.getElementById('nexus-downloader-logs');
            if (logContainer) {
                const logEntry = document.createElement('div');
                logEntry.className = `log-entry log-${type}`;
                logEntry.textContent = logMessage;
                logContainer.appendChild(logEntry);
                logContainer.scrollTop = logContainer.scrollHeight;
                
                while (logContainer.children.length > 100) {
                    logContainer.removeChild(logContainer.firstChild);
                }
            }
        },
        info: (message) => Logger.log(message, 'info'),
        warn: (message) => Logger.log(message, 'warn'),
        error: (message) => Logger.log(message, 'error'),
        success: (message) => Logger.log(message, 'success')
    };

    // 全局函数定义 - 使用 unsafeWindow 绑定
    unsafeWindow.togglePanel = function() {
        const panel = document.getElementById('nexus-downloader-panel');
        if (panel) {
            panel.classList.toggle('show');
        }
    };

    unsafeWindow.switchTab = function(tabName, element) {
        document.querySelectorAll('.nexus-tab-content').forEach(tab => {
            tab.classList.remove('active');
        });

        document.querySelectorAll('.nexus-tab-button').forEach(btn => {
            btn.classList.remove('active');
        });

        const targetTab = document.getElementById(`tab-${tabName}`);
        if (targetTab) {
            targetTab.classList.add('active');
        }

        if (element) {
            element.classList.add('active');
        }
    };

    unsafeWindow.startBatchDownload = function() {
        if (isRunning) {
            Logger.warn('下载器已在运行中');
            return;
        }

        const torrents = extractTorrentInfo();
        if (torrents.length === 0) {
            Logger.warn('未找到可下载的种子');
            return;
        }

        // 直接使用所有种子，不进行过滤
        downloadQueue = [...torrents];
        isRunning = true;
        totalProcessed = 0;
        successCount = 0;
        failCount = 0;

        Logger.info(`开始批量下载，共 ${downloadQueue.length} 个种子`);
        updateStatus();
        processDownloadQueue();
    };



    unsafeWindow.stopDownload = function() {
        isRunning = false;
        downloadQueue = [];
        Logger.info('下载已停止');
        updateStatus();
    };

    unsafeWindow.scanTorrents = function() {
        const torrents = extractTorrentInfo();

        Logger.info(`扫描完成: 找到 ${torrents.length} 个种子`);

        if (torrents.length > 0) {
            Logger.info('种子列表:');
            torrents.forEach((torrent, index) => {
                Logger.info(`${index + 1}. ${torrent.title}`);
            });
        }
    };

    unsafeWindow.saveConfig = function() {
        try {
            CONFIG.downloadDelay = parseInt(document.getElementById('config-delay').value) || 1000;

            GM_setValue('downloadDelay', CONFIG.downloadDelay);

            Logger.success('配置已保存');
        } catch (error) {
            Logger.error(`保存配置失败: ${error.message}`);
        }
    };

    unsafeWindow.resetConfig = function() {
        if (confirm('确定要重置配置吗？')) {
            document.getElementById('config-delay').value = 1000;

            Logger.info('配置已重置');
        }
    };

    unsafeWindow.clearLogs = function() {
        const logContainer = document.getElementById('nexus-downloader-logs');
        if (logContainer) {
            logContainer.innerHTML = '';
            Logger.info('日志已清空');
        }
    };

    // 检测是否为NexusPHP站点
    function isNexusPHPSite() {
        const footer = document.getElementById('footer');
        if (!footer) return false;
        
        const nexusLink = footer.querySelector('a[href*="nexus"], a[href*="aboutnexus.php"]');
        if (!nexusLink) return false;
        
        const linkText = nexusLink.textContent.toLowerCase();
        return linkText.includes('nexusphp') || linkText.includes('nexus');
    }

    // 检测页面类型
    function getPageType() {
        const url = window.location.href;

        if (url.includes('myhr.php') ||
            url.includes('torrents.php') ||
            url.includes('userdetails.php') ||
            url.includes('claim.php')) {
            return 'torrent-list';
        } else if (url.includes('details.php')) {
            return 'torrent-detail';
        }

        return 'unknown';
    }

    // 提取种子信息 - 针对不同页面使用专门的识别逻辑
    function extractTorrentInfo() {
        const torrents = [];
        const url = window.location.href;

        if (url.includes('claim.php')) {
            // claim页面：table#claim-table，跳过第一个tr，从第3列a标签获取ID和名称
            const table = document.querySelector('table#claim-table');
            if (table) {
                const tbody = table.querySelector('tbody');
                if (tbody) {
                    const rows = tbody.querySelectorAll('tr');
                    // 跳过第一个tr（表头）
                    for (let i = 1; i < rows.length; i++) {
                        const row = rows[i];
                        const cells = row.querySelectorAll('td');
                        if (cells.length >= 3) {
                            const nameCell = cells[2]; // 第3列：种子名称
                            const link = nameCell.querySelector('a[href*="details.php"]');
                            if (link) {
                                const idMatch = link.href.match(/id=(\d+)/);
                                const title = link.textContent.trim();
                                if (idMatch && title) {
                                    const id = idMatch[1];
                                    torrents.push({ id, title, row });
                                }
                            }
                        }
                    }
                }
            }
            Logger.info(`📊 claim页面扫描结果：${torrents.length} 个种子`);

        } else if (url.includes('myhr.php')) {
            // myhr页面：table#hr-table，跳过第一个tr，从第2列a标签获取ID和名称
            const table = document.querySelector('table#hr-table');
            if (table) {
                const tbody = table.querySelector('tbody');
                if (tbody) {
                    const rows = tbody.querySelectorAll('tr');
                    // 跳过第一个tr（表头）
                    for (let i = 1; i < rows.length; i++) {
                        const row = rows[i];
                        const cells = row.querySelectorAll('td');
                        if (cells.length >= 2) {
                            const nameCell = cells[1]; // 第2列：种子名称
                            const link = nameCell.querySelector('a[href*="details.php"]');
                            if (link) {
                                const idMatch = link.href.match(/id=(\d+)/);
                                const title = link.textContent.trim();
                                if (idMatch && title) {
                                    const id = idMatch[1];
                                    torrents.push({ id, title, row });
                                }
                            }
                        }
                    }
                }
            }
            Logger.info(`📊 myhr页面扫描结果：${torrents.length} 个种子`);

        } else if (url.includes('userdetails.php')) {
            // userdetails页面：tr中的table，跳过第一个tr，第2列a标签提取ID和名称
            const tables = document.querySelectorAll('tr table');
            for (const table of tables) {
                const tbody = table.querySelector('tbody');
                if (tbody) {
                    const rows = tbody.querySelectorAll('tr');
                    // 跳过第一个tr（表头）
                    for (let i = 1; i < rows.length; i++) {
                        const row = rows[i];
                        const cells = row.querySelectorAll('td');
                        if (cells.length >= 2) {
                            const nameCell = cells[1]; // 第2列：种子名称
                            const link = nameCell.querySelector('a[href*="details.php"]');
                            if (link) {
                                const idMatch = link.href.match(/id=(\d+)/);
                                const bTag = link.querySelector('b');
                                const title = bTag ? bTag.textContent.trim() : link.textContent.trim();
                                if (idMatch && title) {
                                    const id = idMatch[1];
                                    torrents.push({ id, title, row });
                                }
                            }
                        }
                    }
                }
            }
            Logger.info(`📊 userdetails页面扫描结果：${torrents.length} 个种子`);

        } else {
            // 其他页面：使用原来的通用逻辑
            const torrentRows = document.querySelectorAll('table tr');
            torrentRows.forEach(row => {
                const detailLink = row.querySelector('a[href*="details.php"]');
                if (!detailLink) return;

                const title = detailLink.textContent.trim();
                if (!title) return;

                const idMatch = detailLink.href.match(/id=(\d+)/);
                if (!idMatch) return;
                const id = idMatch[1];

                torrents.push({ id, title, row });
            });
            Logger.info(`📊 通用页面扫描结果：${torrents.length} 个种子`);
        }

        // 去重：根据种子ID去除重复项
        const uniqueTorrents = [];
        const seenIds = new Set();

        torrents.forEach(torrent => {
            if (!seenIds.has(torrent.id)) {
                seenIds.add(torrent.id);
                uniqueTorrents.push(torrent);
            }
        });

        Logger.info(`✅ 最终结果：去重后 ${uniqueTorrents.length} 个唯一种子`);
        return uniqueTorrents;
    }





    // 在详情页面查找下载链接
    function findDownloadLink() {
        const downloadLinks = document.querySelectorAll('a[href*="download.php"]');
        return downloadLinks.length > 0 ? downloadLinks[0] : null;
    }

    // 执行下载 - 直接下载模式
    async function downloadTorrent(torrent) {
        try {
            Logger.info(`开始下载: ${torrent.title}`);

            // 如果当前页面就是详情页，直接下载
            if (getPageType() === 'torrent-detail') {
                const downloadLink = findDownloadLink();
                if (downloadLink) {
                    downloadLink.click();
                    Logger.success(`成功触发下载: ${torrent.title}`);
                    return true;
                } else {
                    Logger.error(`未找到下载链接: ${torrent.title}`);
                    return false;
                }
            }

            // 对于列表页面，直接使用直接下载模式
            return await downloadTorrentDirectly(torrent);

        } catch (error) {
            Logger.error(`下载失败 ${torrent.title}: ${error.message}`);
            return false;
        }
    }

    // 直接下载种子 - 不使用弹窗
    async function downloadTorrentDirectly(torrent) {
        return new Promise((resolve) => {
            try {
                Logger.info(`🎯 使用直接下载模式: ${torrent.title}`);
                console.log(torrent.url, 'torrent url');

                // 统一使用ID构造下载链接，确保兼容所有页面
                const baseUrl = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
                const downloadUrl = `${baseUrl}download.php?id=${torrent.id}`;
                Logger.info(`🔗 下载链接: ${downloadUrl}`);

                // 创建隐藏的下载链接
                const downloadLink = document.createElement('a');
                downloadLink.href = downloadUrl;
                downloadLink.style.display = 'none';
                downloadLink.download = torrent.title + '.torrent'; // 设置下载文件名
                downloadLink.target = '_blank';

                document.body.appendChild(downloadLink);

                try {
                    downloadLink.click();
                    Logger.success(`✅ 直接下载已触发: ${torrent.title}`);
                    resolve(true);
                } catch (clickError) {
                    Logger.error(`❌ 直接下载失败: ${torrent.title} - ${clickError.message}`);
                    resolve(false);
                } finally {
                    document.body.removeChild(downloadLink);
                }

            } catch (error) {
                Logger.error(`❌ 下载处理失败: ${torrent.title} - ${error.message}`);
                resolve(false);
            }
        });
    }

    // 处理下载队列 - 修复版本
    async function processDownloadQueue() {
        if (!isRunning || downloadQueue.length === 0) {
            Logger.warn('下载队列为空或已停止');
            return;
        }

        const totalCount = downloadQueue.length;
        Logger.info(`🚀 开始批量下载，共 ${totalCount} 个种子`);

        // 重置计数器
        totalProcessed = 0;
        successCount = 0;
        failCount = 0;

        // 逐个处理种子
        for (let i = 0; i < totalCount && isRunning; i++) {
            if (downloadQueue.length === 0) break;

            const torrent = downloadQueue.shift();
            totalProcessed++;
            currentDownloads = 1;

            updateStatus();

            Logger.info(`📦 正在处理 (${totalProcessed}/${totalCount}): ${torrent.title}`);

            try {
                const success = await downloadTorrent(torrent);

                if (success) {
                    successCount++;
                    Logger.success(`✅ 第 ${totalProcessed} 个下载成功: ${torrent.title}`);
                } else {
                    failCount++;
                    Logger.error(`❌ 第 ${totalProcessed} 个下载失败: ${torrent.title}`);
                }
            } catch (error) {
                failCount++;
                Logger.error(`❌ 第 ${totalProcessed} 个处理出错: ${torrent.title} - ${error.message}`);
            }

            currentDownloads = 0;
            updateStatus();

            // 如果还有更多种子且未停止，添加延迟
            if (i < totalCount - 1 && isRunning) {
                const delaySeconds = (CONFIG.downloadDelay / 1000).toFixed(1);
                Logger.info(`⏳ 等待 ${delaySeconds} 秒后继续下一个...`);
                await new Promise(resolve => setTimeout(resolve, CONFIG.downloadDelay));
            }
        }

        // 完成处理
        isRunning = false;
        currentDownloads = 0;
        downloadQueue = []; // 清空队列
        updateStatus();

        const total = successCount + failCount;
        Logger.success(`🎉 批量下载完成! 总计: ${total}, 成功: ${successCount}, 失败: ${failCount}`);

        if (failCount > 0) {
            Logger.warn(`⚠️ 有 ${failCount} 个种子下载失败，建议手动检查`);
        }

        if (successCount > 0) {
            Logger.info(`💡 提示: 请检查浏览器下载文件夹确认下载结果`);
        }
    }

    // 更新状态显示
    function updateStatus() {
        const statusElement = document.getElementById('nexus-downloader-status');
        if (statusElement) {
            statusElement.innerHTML = `
                <div>状态: ${isRunning ? '运行中' : '已停止'}</div>
                <div>队列: ${downloadQueue.length}</div>
                <div>已处理: ${totalProcessed}</div>
                <div>成功: ${successCount}</div>
                <div>失败: ${failCount}</div>
                <div>当前下载: ${currentDownloads}</div>
            `;
        }
    }

    // 创建用户界面
    function createUI() {
        // 添加样式
        GM_addStyle(`
            #nexus-downloader-panel {
                position: fixed;
                top: 20px;
                right: 20px;
                width: 350px;
                background: #fff;
                border: 2px solid #007cba;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                z-index: 10000;
                font-family: Arial, sans-serif;
                font-size: 12px;
                display: none;
            }

            #nexus-downloader-panel.show {
                display: block;
            }

            .nexus-panel-header {
                background: #007cba;
                color: white;
                padding: 10px;
                border-radius: 6px 6px 0 0;
                font-weight: bold;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .nexus-panel-content {
                padding: 15px;
                max-height: 400px;
                overflow-y: auto;
            }

            .nexus-config-group {
                margin-bottom: 15px;
            }

            .nexus-config-group label {
                display: block;
                margin-bottom: 5px;
                font-weight: bold;
                color: #333;
            }

            .nexus-config-group input, .nexus-config-group textarea {
                width: 100%;
                padding: 5px;
                border: 1px solid #ddd;
                border-radius: 3px;
                box-sizing: border-box;
            }

            .nexus-config-group textarea {
                height: 60px;
                resize: vertical;
            }

            .nexus-button {
                background: #007cba;
                color: white;
                border: none;
                padding: 8px 15px;
                border-radius: 4px;
                cursor: pointer;
                margin-right: 5px;
                margin-bottom: 5px;
            }

            .nexus-button:hover {
                background: #005a87;
            }

            .nexus-button.danger {
                background: #dc3545;
            }

            .nexus-button.danger:hover {
                background: #c82333;
            }

            .nexus-status {
                background: #f8f9fa;
                border: 1px solid #dee2e6;
                border-radius: 4px;
                padding: 10px;
                margin: 10px 0;
                font-family: monospace;
                font-size: 11px;
            }

            .nexus-logs {
                background: #f8f9fa;
                border: 1px solid #dee2e6;
                border-radius: 4px;
                padding: 10px;
                height: 150px;
                overflow-y: auto;
                font-family: monospace;
                font-size: 10px;
                margin-top: 10px;
            }

            .log-entry {
                margin-bottom: 2px;
                padding: 2px;
            }

            .log-info { color: #007bff; }
            .log-success { color: #28a745; }
            .log-warn { color: #ffc107; }
            .log-error { color: #dc3545; }

            #nexus-downloader-toggle {
                position: fixed;
                top: 20px;
                right: 20px;
                background: #007cba;
                color: white;
                border: none;
                padding: 10px 15px;
                border-radius: 6px;
                cursor: pointer;
                z-index: 9999;
                font-weight: bold;
                box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            }

            #nexus-downloader-toggle:hover {
                background: #005a87;
            }

            .nexus-tab-buttons {
                display: flex;
                margin-bottom: 15px;
            }

            .nexus-tab-button {
                flex: 1;
                padding: 8px;
                background: #f8f9fa;
                border: 1px solid #dee2e6;
                cursor: pointer;
                text-align: center;
                color: #333;
                font-weight: normal;
            }

            .nexus-tab-button.active {
                background: #007cba;
                color: white;
                font-weight: bold;
            }

            .nexus-tab-content {
                display: none;
            }

            .nexus-tab-content.active {
                display: block;
            }
        `);

        // 创建切换按钮
        const toggleButton = document.createElement('button');
        toggleButton.id = 'nexus-downloader-toggle';
        toggleButton.textContent = 'NexusPHP下载器';
        toggleButton.onclick = unsafeWindow.togglePanel;
        document.body.appendChild(toggleButton);

        // 创建主面板
        const panel = document.createElement('div');
        panel.id = 'nexus-downloader-panel';
        panel.innerHTML = `
            <div class="nexus-panel-header">
                <span>NexusPHP 智能批量下载器</span>
                <button onclick="togglePanel()" style="background:none;border:none;color:white;cursor:pointer;font-size:16px;">×</button>
            </div>
            <div class="nexus-panel-content">
                <div class="nexus-tab-buttons">
                    <div class="nexus-tab-button active" onclick="switchTab('control', this)">控制</div>
                    <div class="nexus-tab-button" onclick="switchTab('config', this)">配置</div>
                    <div class="nexus-tab-button" onclick="switchTab('logs', this)">日志</div>
                </div>

                <div id="tab-control" class="nexus-tab-content active">
                    <div class="nexus-config-group">
                        <button class="nexus-button" onclick="startBatchDownload()">开始批量下载</button>
                        <button class="nexus-button danger" onclick="stopDownload()">停止下载</button>
                        <button class="nexus-button" onclick="scanTorrents()">扫描种子</button>
                    </div>

                    <div id="nexus-downloader-status" class="nexus-status">
                        <div>状态: 未启动</div>
                        <div>队列: 0</div>
                        <div>已处理: 0</div>
                        <div>成功: 0</div>
                        <div>失败: 0</div>
                        <div>当前下载: 0</div>
                    </div>
                </div>

                <div id="tab-config" class="nexus-tab-content">
                    <div class="nexus-config-group">
                        <label>下载延迟 (毫秒):</label>
                        <input type="number" id="config-delay" value="${CONFIG.downloadDelay}" min="100" max="30000" step="100">
                        <small>设置每个种子下载之间的等待时间</small>
                    </div>

                    <div class="nexus-config-group">
                        <button class="nexus-button" onclick="saveConfig()">保存配置</button>
                        <button class="nexus-button" onclick="resetConfig()">重置配置</button>
                    </div>
                </div>

                <div id="tab-logs" class="nexus-tab-content">
                    <div id="nexus-downloader-logs" class="nexus-logs"></div>
                    <button class="nexus-button" onclick="clearLogs()">清空日志</button>
                </div>
            </div>
        `;

        document.body.appendChild(panel);
    }

    // 主初始化函数
    function init() {
        if (!isNexusPHPSite()) {
            return;
        }

        Logger.info('检测到 NexusPHP 站点，初始化下载器...');

        createUI();

        const pageType = getPageType();
        Logger.info(`页面类型: ${pageType}`);

        if (pageType === 'torrent-detail') {
            // 详情页面自动下载逻辑
            handleDetailPageAutoDownload();
        }
    }

    // 处理详情页面的自动下载 - 增强版本
    function handleDetailPageAutoDownload() {
        // 检查是否来自批量下载
        const urlParams = new URLSearchParams(window.location.search);
        const fromBatch = urlParams.get('auto_download') === '1' ||
                         document.referrer.includes('myhr.php') ||
                         document.referrer.includes('torrents.php');

        if (fromBatch) {
            Logger.info('🔍 检测到需要自动下载，正在查找下载链接...');

            // 多次尝试查找下载链接，确保页面完全加载
            let attempts = 0;
            const maxAttempts = 10;

            const tryDownload = () => {
                attempts++;
                const downloadLink = findDownloadLink();

                if (downloadLink) {
                    Logger.info(`✅ 找到下载链接 (尝试 ${attempts}/${maxAttempts})`);

                    try {
                        // 模拟点击下载链接
                        downloadLink.click();
                        Logger.success('🎯 自动下载已触发!');

                        // 如果是从批量下载打开的，延迟关闭窗口
                        if (fromBatch) {
                            setTimeout(() => {
                                Logger.info('📝 批量下载窗口即将关闭...');
                                window.close();
                            }, 2000);
                        }

                        return; // 成功，退出

                    } catch (error) {
                        Logger.error(`❌ 点击下载链接失败: ${error.message}`);
                    }
                } else {
                    Logger.warn(`⏳ 未找到下载链接 (尝试 ${attempts}/${maxAttempts})`);

                    // 如果还有尝试次数，继续查找
                    if (attempts < maxAttempts) {
                        setTimeout(tryDownload, 1000); // 每秒重试一次
                    } else {
                        Logger.error('❌ 达到最大尝试次数，未找到下载链接');
                        if (fromBatch) {
                            Logger.info('🔗 保持窗口打开，请手动点击下载');
                        }
                    }
                }
            };

            // 开始第一次尝试
            setTimeout(tryDownload, 1000);
        }
    }

    // 主初始化函数
    function init() {
        if (!isNexusPHPSite()) {
            return;
        }

        Logger.info('检测到 NexusPHP 站点，初始化下载器...');

        createUI();

        updateStatus();
        Logger.success('NexusPHP 智能批量下载器已就绪');
    }

    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();

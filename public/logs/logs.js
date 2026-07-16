import { renderIcons } from '/dashboard/modules/icons.js';

// URL 경로에서 토큰 파싱 (예: /admin/토큰)
const pathParts = window.location.pathname.split('/');
const token = pathParts[pathParts.length - 1];

if (!token || token === 'admin') {
  alert('접속 토큰이 누락되었습니다. Discord에서 /logs 명령어를 다시 입력해주세요.');
}

// 전역 차트 인스턴스
let levelChart = null;
let errorTimelineChart = null;
let activityTrendChart = null;
let cpuChart = null;
let memoryChart = null;
let hourlyActiveChart = null;

let errorLabels = [];
let errorTrends = [];

let resourceInterval = null;

// SPA 탭 엘리먼트
const logsTab = document.getElementById('logs-tab');
const statsTab = document.getElementById('stats-tab');
const resourcesTab = document.getElementById('resources-tab');

// 사이드바 메뉴 클릭 핸들러 (SPA 전환)
const menuLogs = document.getElementById('menu-logs');
const menuStats = document.getElementById('menu-stats');
const menuResources = document.getElementById('menu-resources');

function switchTab(activeMenu, activeTab) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  activeMenu.classList.add('active');

  document.querySelectorAll('.tab-content').forEach(el => {
    el.style.display = 'none';
    el.classList.remove('active');
  });
  activeTab.style.display = 'block';
  activeTab.classList.add('active');
}

if (menuLogs) {
  menuLogs.addEventListener('click', () => {
    switchTab(menuLogs, logsTab);
    if (resourceInterval) clearInterval(resourceInterval);
  });
}
if (menuStats) {
  menuStats.addEventListener('click', () => {
    switchTab(menuStats, statsTab);
    if (resourceInterval) clearInterval(resourceInterval);
    fetchStatistics();
  });
}
if (menuResources) {
  menuResources.addEventListener('click', () => {
    switchTab(menuResources, resourcesTab);
    if (resourceInterval) clearInterval(resourceInterval);
    fetchResources();
    resourceInterval = setInterval(fetchResources, 3000);
  });
}

let isGuildsLoaded = false;

// Statistics API Fetcher
async function fetchStatistics() {
  const serverFilter = document.getElementById('server-filter');
  const guildId = serverFilter ? serverFilter.value : 'ALL';

  try {
    const response = await fetch(`/api/statistics?token=${token}&guildId=${guildId}`);
    
    if (response.status === 401) {
      alert('토큰이 만료되었습니다. Discord에서 /logs 명령어를 다시 입력해주세요.');
      window.location.href = '/intro';
      return;
    }
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();

    // 1. 서버 선택 드롭다운 채우기 (최초 1회만)
    if (!isGuildsLoaded && data.guilds && serverFilter) {
      data.guilds.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = g.name;
        serverFilter.appendChild(opt);
      });
      isGuildsLoaded = true;
    }

    // 2. 메트릭 요약 바인딩
    document.getElementById('stat-total-plays').textContent = data.summary.totalPlays || 0;
    document.getElementById('stat-today-plays').textContent = data.summary.todayPlays || 0;
    document.getElementById('stat-total-ai').textContent = data.summary.totalAiCalls || 0;
    document.getElementById('stat-today-ai').textContent = data.summary.todayAiCalls || 0;

    // 3. 인기 곡 목록 렌더링
    const trendingContainer = document.getElementById('trending-list-container');
    trendingContainer.innerHTML = '';
    
    if (data.trendingSongs && data.trendingSongs.length > 0) {
      data.trendingSongs.forEach((song, index) => {
        const item = document.createElement('div');
        item.className = 'trending-item';
        
        // 썸네일 경로
        const thumbUrl = song.artworkUrl || (song.identifier ? `https://i.ytimg.com/vi/${song.identifier}/mqdefault.jpg` : '/dashboard/assets/default-art.png');
        
        item.innerHTML = `
          <div class="trending-rank">${index + 1}</div>
          <img src="${thumbUrl}" alt="Cover" class="trending-thumb" onerror="this.src='/dashboard/assets/default-art.png';" style="width: 40px; height: 40px; border-radius: 4px; object-fit: cover;" />
          <div class="trending-info" style="flex: 1; min-width: 0;">
            <div class="trending-title" style="font-size: 13px; font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(song.title)}</div>
            <div class="trending-artist" style="font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(song.artist)}</div>
          </div>
          <div class="trending-count" style="font-size: 12px; font-weight: 600; color: var(--muted);">${song.count}회 재생</div>
        `;
        trendingContainer.appendChild(item);
      });
    } else {
      trendingContainer.innerHTML = '<div class="empty-state">인기 곡 데이터가 없습니다.</div>';
    }

    // 4. 최근 7일 음악 vs AI 활성 추이 그래프 그리기
    const ctxTrend = document.getElementById('activity-trend-chart').getContext('2d');
    if (activityTrendChart) {
      activityTrendChart.destroy();
    }
    activityTrendChart = new Chart(ctxTrend, {
      type: 'line',
      data: {
        labels: data.activityTrends.dates,
        datasets: [
          {
            label: '음악 재생 횟수',
            data: data.activityTrends.playCounts,
            borderColor: '#3ba55c',
            backgroundColor: 'rgba(59, 165, 92, 0.1)',
            fill: true,
            tension: 0.3
          },
          {
            label: 'AI 호출 횟수',
            data: data.activityTrends.aiCallCounts,
            borderColor: '#5865f2',
            backgroundColor: 'rgba(88, 101, 242, 0.1)',
            fill: true,
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#b9bbbe' } }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#b9bbbe' }
          },
          x: {
            grid: { display: false },
            ticks: { color: '#b9bbbe' }
          }
        }
      }
    });

    // 5. 시간대별 봇 활성도 막대 그래프 그리기
    const ctxHourly = document.getElementById('hourly-active-chart').getContext('2d');
    if (hourlyActiveChart) {
      hourlyActiveChart.destroy();
    }
    const hourlyLabels = Array.from({ length: 24 }, (_, i) => `${i}시`);
    hourlyActiveChart = new Chart(ctxHourly, {
      type: 'bar',
      data: {
        labels: hourlyLabels,
        datasets: [{
          label: '시간대별 음악 재생 수',
          data: data.hourlyStats || new Array(24).fill(0),
          backgroundColor: '#ff5353',
          borderWidth: 1,
          borderColor: '#1e1e1e',
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#b9bbbe', stepSize: 1 }
          },
          x: {
            grid: { display: false },
            ticks: { color: '#b9bbbe', font: { size: 10 } }
          }
        }
      }
    });

  } catch (err) {
    console.error('Failed to fetch statistics:', err);
  }
}
let cpuData = [];
let memoryData = [];
let resourceLabels = [];

async function fetchResources() {
  try {
    const response = await fetch(`/api/system-resources?token=${token}`);
    
    if (response.status === 401) {
      if (resourceInterval) clearInterval(resourceInterval);
      alert('토큰이 만료되었습니다. Discord에서 /logs 명령어를 다시 입력해주세요.');
      window.location.href = '/intro';
      return;
    }
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();

    // 1. 수치 텍스트 바인딩
    document.getElementById('res-cpu').textContent = `${data.cpu}%`;
    document.getElementById('res-memory').textContent = `${data.memory}%`;
    document.getElementById('res-ping').textContent = `${data.ping}ms`;

    const lavalinkVal = document.getElementById('res-lavalink');
    if (data.lavalink === 'connected') {
      lavalinkVal.textContent = '연결됨 (정상)';
      lavalinkVal.style.color = '#3ba55c';
    } else {
      lavalinkVal.textContent = '연결 끊김 (오류)';
      lavalinkVal.style.color = 'var(--red)';
    }

    // 2. 실시간 차트 데이터 갱신 (최근 10개 지점)
    const nowStr = new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    resourceLabels.push(nowStr);
    cpuData.push(data.cpu);
    memoryData.push(data.memory);

    if (resourceLabels.length > 10) {
      resourceLabels.shift();
      cpuData.shift();
      memoryData.shift();
    }

    // 3. CPU 실시간 차트 그리기
    const ctxCpu = document.getElementById('cpu-chart').getContext('2d');
    if (cpuChart) {
      cpuChart.destroy();
    }
    cpuChart = new Chart(ctxCpu, {
      type: 'line',
      data: {
        labels: resourceLabels,
        datasets: [{
          label: 'CPU (%)',
          data: cpuData,
          borderColor: '#ff5353',
          backgroundColor: 'rgba(255, 83, 83, 0.05)',
          fill: true,
          tension: 0.4,
          pointRadius: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { min: 0, max: 100, ticks: { display: false }, grid: { color: 'rgba(255, 255, 255, 0.02)' } },
          x: { ticks: { display: false }, grid: { display: false } }
        }
      }
    });

    // 4. Memory 실시간 차트 그리기
    const ctxMem = document.getElementById('memory-chart').getContext('2d');
    if (memoryChart) {
      memoryChart.destroy();
    }
    memoryChart = new Chart(ctxMem, {
      type: 'line',
      data: {
        labels: resourceLabels,
        datasets: [{
          label: 'Memory (%)',
          data: memoryData,
          borderColor: '#4bc0c0',
          backgroundColor: 'rgba(75, 192, 192, 0.05)',
          fill: true,
          tension: 0.4,
          pointRadius: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { min: 0, max: 100, ticks: { display: false }, grid: { color: 'rgba(255, 255, 255, 0.02)' } },
          x: { ticks: { display: false }, grid: { display: false } }
        }
      }
    });

  } catch (err) {
    console.error('Failed to fetch resources:', err);
  }
}

// 전역 로그 상태
let rawLogs = [];

// 필터 엘리먼트
const levelFilter = document.getElementById('level-filter');
const searchInput = document.getElementById('search-input');
const limitFilter = document.getElementById('limit-filter');
const logsTbody = document.getElementById('logs-tbody');
const logCountBadge = document.getElementById('log-count-badge');
const emptyMessage = document.getElementById('empty-message');
const reloadBtn = document.getElementById('reload-btn');

// 모바일 메뉴 토글
const menuToggleBtn = document.getElementById('menu-toggle-btn');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');

if (menuToggleBtn && sidebar && sidebarOverlay) {
  menuToggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    sidebarOverlay.classList.toggle('visible');
  });

  sidebarOverlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('visible');
  });
}

// API로부터 로그 데이터 가져오기
async function fetchLogs() {
  if (!token) return;

  try {
    reloadBtn.disabled = true;
    reloadBtn.textContent = '로딩 중...';
    
    const response = await fetch(`/api/logs-data?token=${token}`);
    
    if (response.status === 401) {
      alert('토큰이 만료되었습니다. Discord에서 /logs 명령어를 다시 입력해주세요.');
      window.location.href = '/intro';
      return;
    }
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    rawLogs = data.logs;
    errorLabels = data.errorLabels || [];
    errorTrends = data.errorTrends || [];
    
    // 유저 아바타 업데이트
    const userAv = document.querySelector('.user-av');
    if (userAv && data.user) {
      if (data.user.avatarUrl) {
        userAv.innerHTML = `<img src="${data.user.avatarUrl}" alt="${escapeHtml(data.user.displayName)}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%; display: block;" />`;
      } else if (data.user.displayName) {
        userAv.textContent = data.user.displayName.charAt(0).toUpperCase();
      }
    }

    renderLogs();
  } catch (err) {
    console.error('Failed to fetch logs:', err);
    logsTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--red); padding: 40px 0;">로그 데이터를 불러오는 과정에서 오류가 발생했습니다.</td></tr>`;
  } finally {
    reloadBtn.disabled = false;
    reloadBtn.textContent = '새로고침';
  }
}

// 로그 렌더링 함수
function renderLogs() {
  const selectedLevel = levelFilter.value;
  const searchTerm = searchInput.value.toLowerCase().trim();
  const limitValue = limitFilter.value;

  // 1. 필터 적용
  let filtered = rawLogs.filter(log => {
    // 레벨 필터
    if (selectedLevel !== 'ALL' && log.level !== selectedLevel) {
      return false;
    }
    
    // 검색어 필터 (메시지, 카테고리, 혹은 메타데이터 내 특정 값 검색)
    if (searchTerm) {
      const msgMatch = log.message && log.message.toLowerCase().includes(searchTerm);
      const catMatch = log.category && log.category.toLowerCase().includes(searchTerm);
      const metaMatch = log.metadata && JSON.stringify(log.metadata).toLowerCase().includes(searchTerm);
      return msgMatch || catMatch || metaMatch;
    }
    
    return true;
  });

  // 2. 개수 제한 적용
  if (limitValue !== 'ALL') {
    const limit = parseInt(limitValue, 10);
    filtered = filtered.slice(0, limit);
  }

  // 뱃지 업데이트
  logCountBadge.textContent = `${filtered.length}개의 로그`;

  // 테이블 렌더링
  logsTbody.innerHTML = '';
  
  if (filtered.length === 0) {
    emptyMessage.style.display = 'block';
    return;
  }
  
  emptyMessage.style.display = 'none';

  filtered.forEach((log, index) => {
    // Row 1: 기본 로그 정보
    const row = document.createElement('tr');
    row.className = 'log-row';
    row.dataset.index = index;

    // 레벨 클래스 결정
    const levelLower = (log.level || 'info').toLowerCase();
    const badgeClass = ['info', 'warn', 'error'].includes(levelLower) ? levelLower : 'other';

    // 날짜 가공
    const dateStr = log.timestamp 
      ? new Date(log.timestamp).toLocaleString('ko-KR', { hour12: false }) 
      : '-';

    row.innerHTML = `
      <td class="log-time">${dateStr}</td>
      <td><span class="badge ${badgeClass}">${log.level || 'INFO'}</span></td>
      <td class="log-category">${log.category || 'system'}</td>
      <td class="log-message">${escapeHtml(log.message || '')}</td>
    `;

    // Row 2: 클릭 시 펼쳐지는 상세 정보 (메타데이터)
    const detailsRow = document.createElement('tr');
    detailsRow.className = 'details-row';
    detailsRow.id = `details-${index}`;

    const hasMetadata = log.metadata && Object.keys(log.metadata).length > 0;
    const detailsContent = hasMetadata 
      ? JSON.stringify(log.metadata, null, 2) 
      : '추가 메타데이터가 없습니다.';

    detailsRow.innerHTML = `
      <td colspan="4" style="padding: 0;">
        <div class="details-container">
          <div class="details-title">Detailed Metadata & Context</div>
          <pre style="margin: 0;"><code>${escapeHtml(detailsContent)}</code></pre>
        </div>
      </td>
    `;

    // 클릭 이벤트 추가 (토글)
    row.addEventListener('click', () => {
      const isExpanded = row.classList.toggle('expanded');
      detailsRow.classList.toggle('show', isExpanded);
    });

    logsTbody.appendChild(row);
    logsTbody.appendChild(detailsRow);
  });

  renderLogsCharts(filtered);
}

// 로그 통계 요약 차트 렌더링
function renderLogsCharts(filteredLogs) {
  let infoCount = 0;
  let warnCount = 0;
  let errorCount = 0;

  filteredLogs.forEach(log => {
    const lvl = (log.level || 'INFO').toUpperCase();
    if (lvl === 'INFO') infoCount++;
    else if (lvl === 'WARN') warnCount++;
    else if (lvl === 'ERROR') errorCount++;
  });

  // 1. 로그 레벨 도넛 차트
  const ctxLevel = document.getElementById('level-chart').getContext('2d');
  if (levelChart) {
    levelChart.destroy();
  }
  levelChart = new Chart(ctxLevel, {
    type: 'doughnut',
    data: {
      labels: ['INFO', 'WARN', 'ERROR'],
      datasets: [{
        data: [infoCount, warnCount, errorCount],
        backgroundColor: ['#3ba55c', '#f0a020', '#cd2929'],
        borderWidth: 1,
        borderColor: '#1e1e1e'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#b9bbbe', font: { size: 11 } }
        }
      }
    }
  });

  // 2. 최근 30일 경고 & 에러 꺾은선 차트
  const ctxTimeline = document.getElementById('error-timeline-chart').getContext('2d');
  if (errorTimelineChart) {
    errorTimelineChart.destroy();
  }
  errorTimelineChart = new Chart(ctxTimeline, {
    type: 'line',
    data: {
      labels: errorLabels,
      datasets: [{
        label: '경고 & 에러 발생 건수',
        data: errorTrends,
        borderColor: '#cd2929',
        backgroundColor: 'rgba(205, 41, 41, 0.05)',
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#b9bbbe', stepSize: 1 }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#b9bbbe' }
        }
      }
    }
  });
}

// HTML 이스케이프 유틸리티
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 이벤트 리스너 설정
levelFilter.addEventListener('change', renderLogs);
searchInput.addEventListener('input', renderLogs);
limitFilter.addEventListener('change', renderLogs);
reloadBtn.addEventListener('click', fetchLogs);

const serverFilter = document.getElementById('server-filter');
if (serverFilter) {
  serverFilter.addEventListener('change', fetchStatistics);
}

// 초기화
document.addEventListener('DOMContentLoaded', () => {
  renderIcons();
  fetchLogs();
});

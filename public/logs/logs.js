import { renderIcons } from '/dashboard/modules/icons.js';

// URL 경로에서 토큰 파싱 (예: /admin/토큰)
const pathParts = window.location.pathname.split('/');
const token = pathParts[pathParts.length - 1];

if (!token || token === 'admin') {
  alert('접속 토큰이 누락되었습니다. Discord에서 /logs 명령어를 다시 입력해주세요.');
}

// 사이드바 메뉴 클릭 핸들러 (토큰 유지)
const menuDashboard = document.getElementById('menu-dashboard');
if (menuDashboard) {
  menuDashboard.addEventListener('click', () => {
    window.location.href = `/dashboard?token=${token}`;
  });
}
const menuLogs = document.getElementById('menu-logs');
if (menuLogs) {
  menuLogs.addEventListener('click', () => {
    window.location.href = `/admin/${token}`;
  });
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

// 초기화
document.addEventListener('DOMContentLoaded', () => {
  renderIcons();
  fetchLogs();
});

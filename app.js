const DB_KEY = 'tff_ims_v1';
const MIGRATION_FLAG = 'tff_ims_migrated_v1';
const DAYS = [
  { key: 'mon', label: '월' },
  { key: 'tue', label: '화' },
  { key: 'wed', label: '수' },
  { key: 'thu', label: '목' },
  { key: 'fri', label: '금' },
  { key: 'sat', label: '토' }
];
const MON = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

const TYPE_CLASS = {
  '과학&코딩 캠프': 'type-camp',
  '특강수업': 'type-special',
  '세미나&연수': 'type-seminar',
  '동아리': 'type-club',
  '기타사항': 'type-etc'
};
function typeCls(type) { return TYPE_CLASS[type] || 'type-etc'; }

function fmtTime(start, end) {
  if (start && end) return `${start} ~ ${end}`;
  if (start) return start + ' ~';
  if (end) return '~ ' + end;
  return '';
}

let S = {
  instructors: {},
  events: [],
  admins: { admin: null },
  notices: [],
  visits: [],
  currentUser: null,
  isAdmin: false,
  currentAdminName: null,
  currentNoticeId: null,
  currentReviewVisitId: null,
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(),
  instCalYear: new Date().getFullYear(),
  instCalMonth: new Date().getMonth(),
  visitFilter: 'pending',
  instVisitFilter: 'all',
  currentCancelVisitId: null,
  dayFilter: {},
  editingEventIdx: null,
  editingNoticeId: null,
  unsubInst: null,
  unsubEv: null,
  unsubAdm: null,
  unsubNotices: null,
  unsubVisits: null,
  initialized: false
};

async function hashPw(plain) {
  if (!plain) return '';
  const enc = new TextEncoder().encode(plain);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function showLoading(text) {
  document.getElementById('loadingText').textContent = text || '데이터 불러오는 중...';
  document.getElementById('loadingOverlay').classList.add('show');
}
function hideLoading() {
  document.getElementById('loadingOverlay').classList.remove('show');
}

let toastTimer = null;
function toast(msg, kind) {
  const el = document.getElementById('toast');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  void el.offsetWidth;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); }, 2400);
}

function setConnStatus(state, text) {
  ['instConnStatus', 'adminConnStatus'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('online', 'offline', 'connecting');
    el.classList.add(state);
  });
  // 관리자 모드: 원문 그대로
  const adminEl = document.getElementById('adminConnText');
  if (adminEl) adminEl.textContent = text;
  // 강사 모드: "Firebase" → "DB"로 부드럽게 표현
  const instEl = document.getElementById('instConnText');
  if (instEl) instEl.textContent = text.replace(/Firebase/gi, 'DB');
}

async function runMigrationIfNeeded() {
  try {
    if (localStorage.getItem(DB_KEY)) {
      const orphan = localStorage.getItem(DB_KEY);
      localStorage.setItem(DB_KEY + '_orphan_' + Date.now(), orphan);
      localStorage.removeItem(DB_KEY);
    }
    localStorage.removeItem(MIGRATION_FLAG);
  } catch(e) {}
  return;
}

async function ensureDefaultAdmin() {
  if (!S.admins || Object.keys(S.admins).length === 0) {
    const hashed = await hashPw('admin1234');
    await window.DB.setAdmin('admin', hashed);
    return;
  }
  if (!S.admins.admin) {
    const hashed = await hashPw('admin1234');
    await window.DB.setAdmin('admin', hashed);
    return;
  }
}

async function initApp() {
  setConnStatus('connecting', '연결 중');
  showLoading('서버에 연결하는 중...');

  let waitCount = 0;
  while (!window.__dbReady && waitCount < 50) {
    await new Promise(r => setTimeout(r, 100));
    waitCount++;
  }
  if (!window.__dbReady) {
    hideLoading();
    setConnStatus('offline', '연결 실패');
    toast('Firebase 연결에 실패했습니다. 새로고침을 시도하세요.', 'error');
    return;
  }

  try {
    await window.DB.signIn();
    await runMigrationIfNeeded();

    showLoading('데이터 불러오는 중...');
    S.instructors = await window.DB.getAllInstructors();
    S.events = await window.DB.getAllEvents();
    S.admins = await window.DB.getAllAdmins();
    S.notices = await window.DB.getAllNotices();
    try {
      S.visits = await window.DB.getAllVisits();
    } catch(visitErr) {
      console.warn('[officeVisits] 권한 없음 — 사무실 방문 기능이 비활성화됩니다. Firestore 보안 규칙에 officeVisits 컬렉션을 추가하세요.', visitErr && visitErr.message);
      S.visits = [];
    }

    await ensureDefaultAdmin();
    S.admins = await window.DB.getAllAdmins();

    S.unsubInst = window.DB.onInstructorsChange((data) => {
      S.instructors = data;
      onDataChanged('instructors');
    });
    S.unsubEv = window.DB.onEventsChange((data) => {
      S.events = data;
      onDataChanged('events');
    });
    S.unsubAdm = window.DB.onAdminsChange((data) => {
      S.admins = (Object.keys(data).length === 0) ? S.admins : data;
      onDataChanged('admins');
    });
    S.unsubNotices = window.DB.onNoticesChange((data) => {
      S.notices = data;
      onDataChanged('notices');
    });
    try {
      S.unsubVisits = window.DB.onVisitsChange((data) => {
        S.visits = data;
        onDataChanged('visits');
      });
    } catch(e) {
      console.warn('[officeVisits] 실시간 구독 실패 — 보안 규칙 확인 필요.', e && e.message);
    }

    window.DB.onConnectionChange((online) => {
      if (online) setConnStatus('online', 'Firebase 연결됨');
      else setConnStatus('offline', '오프라인');
    });

    S.initialized = true;
    hideLoading();
    setConnStatus('online', 'Firebase 연결됨');
    // 로그인 화면이 보이는 상태라면 공지 알림 표시
    renderLoginNotices();
  } catch(e) {
    console.error('Init failed:', e);
    hideLoading();
    setConnStatus('offline', '연결 실패');
    toast('초기화 실패: ' + e.message, 'error');
  }
}

function onDataChanged(source) {
  if (!S.initialized) return;
  const loginActive = document.getElementById('loginScreen').classList.contains('active');
  const instActive = document.getElementById('instScreen').classList.contains('active');
  const adminActive = document.getElementById('adminScreen').classList.contains('active');

  // 로그인 화면: 공지/일정/강사(=내 신청 변동) 모두 알림에 영향
  if (loginActive && (source === 'notices' || source === 'events' || source === 'instructors')) {
    renderLoginNotices();
  }

  if (instActive) {
    const evPage = document.getElementById('ipEvents');
    if (evPage && evPage.classList.contains('active')) renderInstEvents();
    const ntPage = document.getElementById('ipNotices');
    if (ntPage && ntPage.classList.contains('active')) renderInstNotices();
    const calPageI = document.getElementById('ipCalendar');
    if (calPageI && calPageI.classList.contains('active')) renderInstCal();
    const visitsPageI = document.getElementById('ipVisits');
    if (visitsPageI && visitsPageI.classList.contains('active')) renderInstVisits();
  }
  if (adminActive) {
    if (source === 'instructors') updatePendingBadge();
    if (source === 'visits' || source === 'instructors') updateVisitBadge();

    const calPage = document.getElementById('apCalendar');
    if (calPage && calPage.classList.contains('active')) renderCal();
    const schPage = document.getElementById('apSchedule');
    if (schPage && schPage.classList.contains('active')) renderAdminSchedule();
    const instListPage = document.getElementById('apInstructors');
    if (instListPage && instListPage.classList.contains('active')) renderInstList();
    const gradePage = document.getElementById('apGrade');
    if (gradePage && gradePage.classList.contains('active')) renderGradeTab();
    const settingsPage = document.getElementById('apSettings');
    if (settingsPage && settingsPage.classList.contains('active')) renderAdminList();
    const notPage = document.getElementById('apNotices');
    if (notPage && notPage.classList.contains('active')) renderAdminNotices();
    const apprPage = document.getElementById('apApproval');
    if (apprPage && apprPage.classList.contains('active')) renderApprovalList();
    const visitsPage = document.getElementById('apVisits');
    if (visitsPage && visitsPage.classList.contains('active')) renderAdminVisits();
  }

  if (source === 'notices' && S.currentNoticeId) {
    const modal = document.getElementById('noticeDetailModal');
    if (modal && modal.classList.contains('open')) {
      const updated = S.notices.find(n => n._id === S.currentNoticeId);
      if (updated) renderNoticeDetail(updated);
    }
  }
}

function showErr(msg, type) {
  const e = document.getElementById('loginErr');
  e.textContent = msg;
  e.className = 'err-msg' + (type ? ' ' + type : '');
  e.style.display = 'block';
}

// ══════════════════════════════════════════════════════════════════
// 강사 로그인/가입 헬퍼
// ══════════════════════════════════════════════════════════════════

// baseName(본 이름)이 일치하는 강사 PK 목록 반환
function _findInstructorPKsByName(baseName) {
  const target = (baseName || '').trim();
  if (!target) return [];
  const pks = [];
  Object.keys(S.instructors).forEach(pk => {
    const u = S.instructors[pk];
    const bn = (u.baseName || u.name || pk).trim();
    if (bn === target) pks.push(pk);
  });
  return pks;
}

// PK 만들기: 동명이인 없으면 이름 그대로, 있으면 이름_식별자
function _makeInstructorPK(name, identifier) {
  if (!identifier) return name;
  // 식별자에 PK로 안전하지 않은 문자 제거
  const safe = identifier.replace(/[\s\/\\'"`]/g, '_');
  return `${name}_${safe}`;
}

async function loginInst() {
  if (!S.initialized) { showErr('아직 초기화 중입니다. 잠시 후 다시 시도하세요.'); return; }
  const name = document.getElementById('iName').value.trim();
  const pw = document.getElementById('iPw').value.trim();
  if (!name || !pw) { showErr('이름과 비밀번호를 입력하세요.'); return; }

  showLoading('확인 중...');
  try {
    const hashedPw = await hashPw(pw);

    // 동일 baseName의 강사 PK들 찾기
    const matchingPKs = _findInstructorPKsByName(name);

    if (matchingPKs.length === 0) {
      // 등록되지 않은 이름 → 가입 안내
      hideLoading();
      showErr(
        '❌ 등록되지 않은 이름입니다.\n' +
        '신규 강사이신가요? 위의 [가입 신청하기 →] 링크를 눌러 가입을 먼저 진행해 주세요.',
        'warn'
      );
      return;
    }

    if (matchingPKs.length === 1) {
      // 단일 강사 - 비번 확인
      const pk = matchingPKs[0];
      await _finalizeLoginInst(pk, hashedPw);
      return;
    }

    // 동명이인 - 선택 모달
    hideLoading();
    _openPickInstructorModal(name, matchingPKs, hashedPw);
  } catch(e) {
    hideLoading();
    showErr('로그인 실패: ' + e.message);
  }
}

// 비번 검증 + 로그인 완료 처리 (PK 기준)
async function _finalizeLoginInst(pk, hashedPw) {
  const u = S.instructors[pk];
  if (!u) { hideLoading(); showErr('강사 정보를 찾을 수 없습니다.'); return; }
  if (u.pw !== hashedPw) {
    hideLoading();
    showErr('비밀번호가 틀렸습니다.');
    return;
  }
  const status = u.status || 'approved';
  if (status === 'pending') {
    hideLoading();
    showErr(
      '🕐 관리자 승인 대기 중입니다.\n' +
      '신청이 정상 접수되었으니 관리자의 승인을 기다려 주세요.\n' +
      '승인이 완료되면 입력하신 비밀번호로 바로 로그인할 수 있습니다.',
      'warn'
    );
    return;
  }
  if (status === 'rejected') {
    hideLoading();
    showErr('❌ 가입 신청이 거절되었습니다.\n자세한 사항은 관리자에게 문의해 주세요.');
    return;
  }

  await window.DB.signIn();
  document.getElementById('loginErr').style.display = 'none';
  S.currentUser = pk;
  S.isAdmin = false;
  try { localStorage.setItem('tff_last_user', pk); } catch(e) {}
  hideLoading();
  showScreen('instScreen');
  loadInstProfile();
  renderInstNotices();
  renderInstEvents();
}

// 동명이인 선택 모달 열기
function _openPickInstructorModal(name, pks, hashedPw) {
  document.getElementById('pickMsgName').textContent = `'${name}'`;
  const list = document.getElementById('pickInstructorList');
  list.innerHTML = '';
  pks.forEach(pk => {
    const u = S.instructors[pk];
    const displayName = u.displayName || u.name || pk;
    const ident = u.identifier ? `식별: ${u.identifier}` : '식별 없음';
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.style.cssText = 'width:100%;text-align:left;padding:12px 14px;display:flex;flex-direction:column;align-items:flex-start;gap:3px;border:1px solid var(--border);background:var(--surface);';
    btn.innerHTML = `<span style="font-weight:700;font-size:14px;">${_escapeHtml(displayName)}</span>
      <span style="font-size:11px;color:var(--text-hint);">${_escapeHtml(ident)}</span>`;
    btn.onclick = async () => {
      closeModal('pickInstructorModal');
      showLoading('확인 중...');
      await _finalizeLoginInst(pk, hashedPw);
    };
    list.appendChild(btn);
  });
  openModal('pickInstructorModal');
}

// 신규 가입 모달 열기
function openSignupModal() {
  ['suName', 'suPw', 'suPw2'].forEach(id => { document.getElementById(id).value = ''; });
  const errEl = document.getElementById('signupErr');
  errEl.style.display = 'none';
  errEl.textContent = '';
  openModal('signupModal');
  setTimeout(() => document.getElementById('suName').focus(), 100);
}

function _showSignupErr(msg) {
  const el = document.getElementById('signupErr');
  el.textContent = msg;
  el.style.display = 'block';
}

// 가입 신청 처리 (1단계) — 동명이인 확인 후 분기
async function submitSignup() {
  if (!S.initialized) { _showSignupErr('아직 초기화 중입니다. 잠시 후 다시 시도하세요.'); return; }
  const name = document.getElementById('suName').value.trim();
  const pw = document.getElementById('suPw').value.trim();
  const pw2 = document.getElementById('suPw2').value.trim();

  if (!name) { _showSignupErr('이름을 입력하세요.'); return; }
  if (!pw) { _showSignupErr('비밀번호를 입력하세요.'); return; }
  if (pw.length < 6) { _showSignupErr('비밀번호는 6자 이상으로 입력하세요.'); return; }
  if (pw !== pw2) { _showSignupErr('비밀번호 확인이 일치하지 않습니다.'); return; }

  // 동명이인 체크
  const existing = _findInstructorPKsByName(name);
  if (existing.length > 0) {
    // 식별자 요청 모달로 분기 (pw는 임시 저장)
    S._pendingSignup = { name, pw };
    closeModal('signupModal');
    _openIdentifierModal(name);
    return;
  }

  // 동명이인 없음 → 바로 가입
  await _createInstructor(name, pw, '');
}

function _openIdentifierModal(name) {
  document.getElementById('idmsgName').textContent = `'${name}'`;
  document.getElementById('idValue').value = '';
  document.getElementById('idPreview').textContent = `${name} (...)`;
  const errEl = document.getElementById('identifierErr');
  errEl.style.display = 'none';
  errEl.textContent = '';
  // 입력에 따라 미리보기 갱신
  const input = document.getElementById('idValue');
  input.oninput = () => {
    const v = input.value.trim();
    document.getElementById('idPreview').textContent = v ? `${name} (${v})` : `${name} (...)`;
  };
  openModal('identifierModal');
  setTimeout(() => input.focus(), 100);
}

// 가입 신청 처리 (2단계) — 식별자 함께 등록
async function submitSignupWithIdentifier() {
  const pending = S._pendingSignup;
  if (!pending) { closeModal('identifierModal'); return; }
  const ident = document.getElementById('idValue').value.trim();
  if (!ident) {
    document.getElementById('identifierErr').textContent = '식별자를 입력하세요.';
    document.getElementById('identifierErr').style.display = 'block';
    return;
  }
  // PK 충돌 한 번 더 검사 (혹시 같은 식별자로 또 가입했을 경우)
  const candidatePK = _makeInstructorPK(pending.name, ident);
  if (S.instructors[candidatePK]) {
    document.getElementById('identifierErr').textContent = `이미 같은 식별자로 등록된 강사가 있습니다. 다른 식별자를 사용해 주세요.`;
    document.getElementById('identifierErr').style.display = 'block';
    return;
  }
  await _createInstructor(pending.name, pending.pw, ident);
}

// 실제 강사 생성 (동명이인 유무 관계없이 공통)
async function _createInstructor(name, pw, identifier) {
  showLoading('가입 신청 중...');
  try {
    const hashedPw = await hashPw(pw);
    const pk = _makeInstructorPK(name, identifier);
    const displayName = identifier ? `${name} (${identifier})` : name;
    const newProfile = {
      pw: hashedPw,
      name: pk,            // PK를 name 필드에도 (기존 호환)
      baseName: name,      // 검색용 본 이름
      identifier: identifier,
      displayName: displayName,
      email: '', phone: '', addr: '', subject: '',
      eduLevel: '', isMajor: '', manualScore: 0,
      edu: ['','',''], career: ['','','','',''], certs: ['','','','',''],
      certCategories: [], days: {}, carOwn: '', appeal: '',
      applications: {}, status: 'pending',
      registeredAt: new Date().toISOString()
    };
    await window.DB.signIn();
    await window.DB.saveInstructor(pk, newProfile);
    S.instructors[pk] = newProfile;
    try { localStorage.setItem('tff_last_user', pk); } catch(e) {}
    S._pendingSignup = null;
    closeModal('signupModal');
    closeModal('identifierModal');
    hideLoading();
    showErr(
      '✅ 가입 신청이 접수되었습니다!\n' +
      `'${displayName}' 님의 신청이 관리자에게 전달되었습니다.\n` +
      '관리자가 승인하면 등록하신 비밀번호로 로그인할 수 있습니다.',
      'success'
    );
  } catch(e) {
    hideLoading();
    if (document.getElementById('identifierModal').classList.contains('open')) {
      document.getElementById('identifierErr').textContent = '가입 실패: ' + e.message;
      document.getElementById('identifierErr').style.display = 'block';
    } else {
      _showSignupErr('가입 실패: ' + e.message);
    }
  }
}

async function loginAdmin() {
  if (!S.initialized) { showAdminLoginErr('아직 초기화 중입니다. 잠시 후 다시 시도하세요.'); return; }
  const name = document.getElementById('aName').value.trim();
  const pw = document.getElementById('aPw').value;
  if (!name || !pw) { showAdminLoginErr('이름과 비밀번호를 입력하세요.'); return; }
  if (!S.admins[name]) { showAdminLoginErr('관리자 계정이 없습니다.'); return; }

  showLoading('확인 중...');
  try {
    const hashedPw = await hashPw(pw);
    if (S.admins[name] !== hashedPw) {
      hideLoading();
      showAdminLoginErr('비밀번호가 틀렸습니다.');
      return;
    }

    await window.DB.signIn();

    closeModal('adminLoginModal');
    document.getElementById('loginErr').style.display = 'none';
    S.isAdmin = true; S.currentAdminName = name;
    document.getElementById('adminTopName').textContent = name + ' 관리자';
    hideLoading();
    showScreen('adminScreen');
    renderAdminNotices();
    renderCal();
    initDayFilter();
    updatePendingBadge();
  } catch(e) {
    hideLoading();
    showAdminLoginErr('로그인 실패: ' + e.message);
  }
}

function openAdminLoginModal() {
  document.getElementById('aName').value = '';
  document.getElementById('aPw').value = '';
  const err = document.getElementById('adminLoginErr');
  if (err) { err.style.display = 'none'; err.className = 'err-msg'; }
  openModal('adminLoginModal');
  setTimeout(() => {
    const inp = document.getElementById('aName');
    if (inp) inp.focus();
  }, 100);
}

function closeAdminLoginModal() {
  closeModal('adminLoginModal');
}

function showAdminLoginErr(msg) {
  const e = document.getElementById('adminLoginErr');
  if (!e) { showErr(msg); return; }
  e.textContent = msg;
  e.className = 'err-msg';
  e.style.display = 'block';
}

function logout() {
  if (window.DB && window.DB.signOut) {
    window.DB.signOut().catch(() => {});
  }
  S.currentUser = null; S.isAdmin = false; S.currentAdminName = null;
  showScreen('loginScreen');
  ['iName','iPw','aName','aPw'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => { s.style.display = 'none'; s.classList.remove('active'); });
  const s = document.getElementById(id);
  s.style.display = id === 'loginScreen' ? 'flex' : 'block';
  s.classList.add('active');
  // 로그인 화면으로 돌아왔을 때 공지 알림 갱신
  if (id === 'loginScreen') renderLoginNotices();
}

function showIP(id, btn) {
  document.querySelectorAll('#instScreen .page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('#instScreen .nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('ip' + id).classList.add('active');
  if (btn) {
    btn.classList.add('active');
    scrollNavBtnIntoView(btn);
  }

  if (id === 'Events') renderInstEvents();
  if (id === 'Profile') loadInstProfile();
  if (id === 'Settings') loadInstSettings();
  if (id === 'Notices') renderInstNotices();
  if (id === 'Calendar') renderInstCal();
  if (id === 'Visits') renderInstVisits();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showAP(id, btn) {
  document.querySelectorAll('#adminScreen .page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('#adminScreen .nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('ap' + id).classList.add('active');
  if (btn) {
    btn.classList.add('active');
    scrollNavBtnIntoView(btn);
  }

  if (id === 'Calendar') { renderCal(); renderMonthList(); }
  if (id === 'Schedule') renderAdminSchedule();
  if (id === 'Instructors') renderInstList();
  if (id === 'Search') { showAP('Instructors', document.querySelector('#adminNav .nav-btn[onclick*="Instructors"]')); return; }
  if (id === 'Grade') renderGradeTab();
  if (id === 'Settings') renderAdminList();
  if (id === 'System') { refreshLastBackupTime(); renderManualIfShown(); }
  if (id === 'Notices') renderAdminNotices();
  if (id === 'Approval') renderApprovalList();
  if (id === 'Visits') renderAdminVisits();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function scrollNavBtnIntoView(btn) {
  if (!btn) return;
  const nav = btn.closest('.nav');
  if (!nav) return;
  setTimeout(() => {
    const navRect = nav.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    if (btnRect.left < navRect.left || btnRect.right > navRect.right - 40) {
      const scrollTo = btn.offsetLeft - (nav.offsetWidth - btn.offsetWidth) / 2;
      nav.scrollTo({ left: Math.max(0, scrollTo), behavior: 'smooth' });
    }
  }, 50);
}

function getProfile(u) {
  if (!u.edu) u.edu = ['','',''];
  if (!u.career) u.career = ['','','','',''];
  if (!u.certs) u.certs = ['','','','',''];
  if (!Array.isArray(u.certCategories)) u.certCategories = [];
  if (!u.days) u.days = {};
  if (!u.email) u.email = '';
  if (!u.carOwn) u.carOwn = '';
  if (!u.appeal) u.appeal = '';
  if (!u.applications) u.applications = {};
  if (!u.status) u.status = 'approved';
  // 새로 추가된 필드 기본값
  if (!u.eduLevel) u.eduLevel = ''; 
  if (u.isMajor === undefined) u.isMajor = '';
  if (typeof u.manualScore !== 'number') u.manualScore = 0;
  if (!u.ssn1) u.ssn1 = '';
  if (!u.ssn2) u.ssn2 = '';
  // 동명이인 처리용 필드 (기존 강사는 이름 = PK = displayName)
  if (!u.baseName) u.baseName = u.name || '';
  if (!u.identifier) u.identifier = '';
  if (!u.displayName) u.displayName = u.baseName + (u.identifier ? ` (${u.identifier})` : '');
  return u;
}

function toggleCertCategories() {
  const panel = document.getElementById('pCertCatPanel');
  if (!panel) return;
  const isHidden = panel.style.display === 'none' || panel.style.display === '';
  panel.style.display = isHidden ? 'block' : 'none';
  _updateCertCatLabel();
}

function _updateCertCatLabel() {
  const label = document.getElementById('pCertCatLabel');
  const panel = document.getElementById('pCertCatPanel');
  if (!label) return;
  const count = document.querySelectorAll('#pCertCatPanel input[data-cert-cat]:checked').length;
  const open = panel && panel.style.display === 'block';
  const arrow = open ? '▲' : '▼';
  label.textContent = count > 0 ? `${count}개 선택됨 ${arrow}` : `선택 안함 ${arrow}`;
}

function loadInstProfile() {
  const u = getProfile(S.instructors[S.currentUser]);
  document.getElementById('instTopName').textContent = (u.displayName || u.name || S.currentUser) + '님';
  document.getElementById('pName').value = u.name || S.currentUser;
  document.getElementById('pSsn1').value = u.ssn1 || '';
  document.getElementById('pSsn2').value = u.ssn2 || '';
  document.getElementById('pEmail').value = u.email || '';
  document.getElementById('pPhone').value = u.phone || '';
  document.getElementById('pAddr').value = u.addr || '';
  document.getElementById('pSubject').value = u.subject || '';
  
  // 새 필드 불러오기
  document.getElementById('pEduLevel').value = u.eduLevel || '';
  document.getElementById('pIsMajor').value = u.isMajor !== '' ? String(u.isMajor) : '';

  for (let i = 0; i < 3; i++) document.getElementById(`pEdu${i+1}`).value = u.edu[i] || '';
  for (let i = 0; i < 5; i++) document.getElementById(`pCar${i+1}`).value = u.career[i] || '';
  for (let i = 0; i < 5; i++) document.getElementById(`pCert${i+1}`).value = u.certs[i] || '';

  // 자격증 카테고리 체크박스 반영 + 라벨 업데이트
  const certCats = Array.isArray(u.certCategories) ? u.certCategories : [];
  document.querySelectorAll('#pCertCatPanel input[data-cert-cat]').forEach(cb => {
    cb.checked = certCats.includes(cb.dataset.certCat);
  });
  // 패널은 기본적으로 접힌 상태로 시작
  const panel = document.getElementById('pCertCatPanel');
  if (panel) panel.style.display = 'none';
  _updateCertCatLabel();

  document.getElementById('pCarY').checked = u.carOwn === '있음';
  document.getElementById('pCarN').checked = u.carOwn === '없음';
  document.getElementById('pAppeal').value = u.appeal || '';
  DAYS.forEach(d => {
    document.getElementById(`d_${d.key}_am`).checked = !!(u.days[d.key + '_am']);
    document.getElementById(`d_${d.key}_pm`).checked = !!(u.days[d.key + '_pm']);
  });

  // 검증 실패 표시 초기화
  _clearProfileInvalid();
}

function _clearProfileInvalid() {
  ['pName','pSsn1','pSsn2','pEmail','pPhone','pAddr','pEduLevel','pIsMajor','pCertCatToggle'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('invalid');
  });
}

function _markInvalid(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('invalid');
}

function validateProfileInputs() {
  _clearProfileInvalid();
  const errors = [];

  const name = document.getElementById('pName').value.trim();
  if (!name) { errors.push({ id:'pName', label:'이름' }); }

  const ssn1 = document.getElementById('pSsn1').value.trim();
  const ssn2 = document.getElementById('pSsn2').value.trim();
  if (!ssn1) {
    errors.push({ id:'pSsn1', label:'주민번호 앞자리' });
  } else if (!/^\d{6}$/.test(ssn1)) {
    errors.push({ id:'pSsn1', label:'주민번호 앞자리는 숫자 6자리' });
  }
  if (!ssn2) {
    errors.push({ id:'pSsn2', label:'주민번호 성별 구분' });
  } else if (!/^[1-8]$/.test(ssn2)) {
    errors.push({ id:'pSsn2', label:'주민번호 성별 구분은 1~8' });
  }

  const email = document.getElementById('pEmail').value.trim();
  if (!email) errors.push({ id:'pEmail', label:'이메일' });

  const phone = document.getElementById('pPhone').value.trim();
  if (!phone) errors.push({ id:'pPhone', label:'연락처' });

  const addr = document.getElementById('pAddr').value.trim();
  if (!addr) errors.push({ id:'pAddr', label:'주소' });

  if (!document.getElementById('pEduLevel').value) {
    errors.push({ id:'pEduLevel', label:'최종 학력' });
  }
  if (!document.getElementById('pIsMajor').value) {
    errors.push({ id:'pIsMajor', label:'관련 전공' });
  }

  const certCount = document.querySelectorAll('#pCertCatPanel input[data-cert-cat]:checked').length;
  if (certCount === 0) {
    errors.push({ id:'pCertCatToggle', label:'보유 자격증 종류 (최소 1개)' });
  }

  errors.forEach(e => _markInvalid(e.id));
  return errors;
}

async function saveProfile() {
  if (!S.currentUser) return;

  // 필수 입력 검증
  const errors = validateProfileInputs();
  if (errors.length > 0) {
    const first = errors[0];
    toast(`필수 입력: ${first.label}${errors.length > 1 ? ` 외 ${errors.length-1}건` : ''}`, 'error');
    const el = document.getElementById(first.id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (el.focus) try { el.focus(); } catch(e) {}
    }
    // 자격증 카테고리 검증 실패면 펼침 자동 열기
    if (errors.some(e => e.id === 'pCertCatToggle')) {
      const panel = document.getElementById('pCertCatPanel');
      if (panel && panel.style.display === 'none') {
        panel.style.display = 'block';
        _updateCertCatLabel();
      }
    }
    return;
  }

  const u = getProfile({ ...(S.instructors[S.currentUser] || {}) });
  u.name = document.getElementById('pName').value.trim();
  u.ssn1 = document.getElementById('pSsn1').value.trim();
  u.ssn2 = document.getElementById('pSsn2').value.trim();
  u.email = document.getElementById('pEmail').value.trim();
  u.phone = document.getElementById('pPhone').value.trim();
  u.addr = document.getElementById('pAddr').value.trim();
  u.subject = document.getElementById('pSubject').value;
  
  // 새 필드 저장
  u.eduLevel = document.getElementById('pEduLevel').value;
  const majorVal = document.getElementById('pIsMajor').value;
  u.isMajor = majorVal === 'true' ? true : majorVal === 'false' ? false : '';

  u.edu = [1,2,3].map(i => document.getElementById(`pEdu${i}`).value.trim());
  u.career = [1,2,3,4,5].map(i => document.getElementById(`pCar${i}`).value.trim());
  u.certs = [1,2,3,4,5].map(i => document.getElementById(`pCert${i}`).value.trim());

  // 자격증 카테고리 수집 (체크된 항목만)
  u.certCategories = Array.from(
    document.querySelectorAll('#pCertCatPanel input[data-cert-cat]:checked')
  ).map(cb => cb.dataset.certCat);

  const carChecked = document.querySelector('input[name="pCar"]:checked');
  u.carOwn = carChecked ? carChecked.value : '';
  u.appeal = document.getElementById('pAppeal').value.trim();
  u.days = {};
  DAYS.forEach(d => {
    u.days[d.key + '_am'] = document.getElementById(`d_${d.key}_am`).checked;
    u.days[d.key + '_pm'] = document.getElementById(`d_${d.key}_pm`).checked;
  });

  try {
    await window.DB.saveInstructor(S.currentUser, u);
    S.instructors[S.currentUser] = u;
    const m = document.getElementById('saveMsg');
    m.style.display = 'inline';
    setTimeout(() => m.style.display = 'none', 2000);
  } catch(e) {
    toast('저장 실패: ' + e.message, 'error');
  }
}

function loadInstSettings() {
  const u = S.instructors[S.currentUser];
  if (!u) return;
  document.getElementById('instSettingName').textContent = S.currentUser;
  document.getElementById('instSettingEmail').textContent = u.email || '-';
  document.getElementById('instSettingPhone').textContent = u.phone || '-';
  ['instCurPw', 'instNewPw', 'instNewPw2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('instPwMsg').style.display = 'none';
}

async function changeInstPw() {
  const cur = document.getElementById('instCurPw').value;
  const nw = document.getElementById('instNewPw').value;
  const nw2 = document.getElementById('instNewPw2').value;
  const msg = document.getElementById('instPwMsg');

  function showMsg(text, color) {
    msg.textContent = text;
    msg.style.color = color;
    msg.style.display = 'inline';
  }

  if (!cur) { showMsg('현재 비밀번호를 입력하세요.', 'var(--red)'); return; }
  if (!nw)  { showMsg('새 비밀번호를 입력하세요.', 'var(--red)'); return; }
  if (nw.length < 6) { showMsg('새 비밀번호는 6자 이상이어야 합니다.', 'var(--red)'); return; }
  if (nw !== nw2) { showMsg('새 비밀번호가 일치하지 않습니다.', 'var(--red)'); return; }
  if (nw === cur) { showMsg('새 비밀번호가 현재 비밀번호와 같습니다.', 'var(--red)'); return; }

  try {
    showLoading('비밀번호 변경 중...');
    const u = S.instructors[S.currentUser];
    if (!u) { hideLoading(); showMsg('사용자 정보 오류', 'var(--red)'); return; }

    const curHash = await hashPw(cur);
    if (u.pw !== curHash) {
      hideLoading();
      showMsg('현재 비밀번호가 틀렸습니다.', 'var(--red)');
      return;
    }

    const newHash = await hashPw(nw);
    await window.DB.updateInstructor(S.currentUser, { pw: newHash });
    u.pw = newHash;

    hideLoading();
    showMsg('✓ 비밀번호가 변경되었습니다. 잠시 후 로그아웃됩니다.', 'var(--green)');

    setTimeout(() => {
      toast('새 비밀번호로 다시 로그인해주세요.', 'success');
      logout();
    }, 1800);
  } catch(e) {
    hideLoading();
    showMsg('변경 실패: ' + e.message, 'var(--red)');
  }
}

// 강사 화면 일정 필터 상태 ('upcoming' | 'past' | 'all'). 페이지 이동에도 유지됨.
let _instEventFilter = 'upcoming';

function _instTodayStr() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function setInstEventFilter(mode) {
  _instEventFilter = mode;
  renderInstEvents();
}

function renderInstEvents() {
  const list = document.getElementById('instEvList');
  const myApp = document.getElementById('myApps');
  const u = S.instructors[S.currentUser];
  if (!u) { list.innerHTML = ''; myApp.innerHTML = ''; return; }

  const todayStr = _instTodayStr();

  // ─── 일정 정렬: 날짜+시작시간 오름차순 ───
  const sortedEvents = [...S.events].sort((a, b) => {
    const ka = (a.date || '') + 'T' + (a.startTime || '00:00');
    const kb = (b.date || '') + 'T' + (b.startTime || '00:00');
    return ka.localeCompare(kb);
  });

  // ─── 필터 적용 ───
  const upcomingCnt = sortedEvents.filter(ev => ev.date >= todayStr).length;
  const pastCnt = sortedEvents.filter(ev => ev.date < todayStr).length;
  const totalCnt = sortedEvents.length;
  const filtered = sortedEvents.filter(ev => {
    if (_instEventFilter === 'upcoming') return ev.date >= todayStr;
    if (_instEventFilter === 'past') return ev.date < todayStr;
    return true;
  });

  // ─── 필터 토글 UI ───
  const filterBar = `
    <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;">
      <button class="btn sm ${_instEventFilter==='upcoming'?'primary':''}" onclick="setInstEventFilter('upcoming')">앞으로 예정 (${upcomingCnt})</button>
      <button class="btn sm ${_instEventFilter==='past'?'primary':''}" onclick="setInstEventFilter('past')">지난 일정 (${pastCnt})</button>
      <button class="btn sm ${_instEventFilter==='all'?'primary':''}" onclick="setInstEventFilter('all')">전체 (${totalCnt})</button>
    </div>`;

  if (!S.events.length) {
    list.innerHTML = '<p class="empty-msg">등록된 일정이 없습니다.</p>';
    myApp.innerHTML = '';
    return;
  }

  if (!filtered.length) {
    list.innerHTML = filterBar + '<p class="empty-msg">해당 조건의 일정이 없습니다.</p>';
  } else {
    list.innerHTML = filterBar;
    filtered.forEach((ev) => {
      const evId = ev._id;
      const applied = u.applications && u.applications[evId];
      const isPast = ev.date < todayStr;
      const timeStr = fmtTime(ev.startTime, ev.endTime);
      const isClosed = ev.status === 'closed';
      const d = document.createElement('div');
      d.className = 'ev-item';
      if (isPast || isClosed) d.style.opacity = '0.55';
      const statusBadge = applied
        ? `<span class="badge ${applied}">${applied==='pending'?'신청중':applied==='approved'?'승인됨':'✨ 다음 기회에'}</span>`
        : '';
      // 마감/종료 시 버튼 숨김, 신청 가능할 때만 신청/취소 버튼
      let actionHtml = '';
      if (isClosed) {
        actionHtml = `<span class="badge" style="background:var(--bg);color:var(--text-sub);">🔒 모집 마감</span>`;
      } else if (isPast) {
        actionHtml = applied ? '' : `<span class="badge" style="background:var(--bg);color:var(--text-hint);">종료</span>`;
      } else if (applied) {
        actionHtml = `<button class="btn sm danger" onclick="cancelApp('${evId}')">신청 취소</button>`;
      } else {
        actionHtml = `<button class="btn sm primary" onclick="applyEv('${evId}')">신청</button>`;
      }
      const titleSuffix = isPast ? ' <span style="font-size:11px;color:var(--text-hint);font-weight:400;">(종료)</span>'
                       : isClosed ? ' <span style="font-size:11px;color:var(--text-sub);font-weight:400;">(모집 마감)</span>'
                       : '';
      d.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
        <div style="display:flex;align-items:flex-start;flex:1;min-width:0;">
          <span class="type-stripe ${typeCls(ev.type)}"></span>
          <div style="flex:1;min-width:0;">
            <div class="ev-title">[${ev.type}] ${ev.title}${titleSuffix}</div>
            <div class="ev-meta">${ev.date}${timeStr ? ' · ' + timeStr : ''} &middot; ${ev.place}</div>
            <div class="ev-desc">${_escapeHtml(ev.desc || '')}</div>
          </div>
        </div>
        <div style="flex-shrink:0;display:flex;flex-direction:column;gap:5px;align-items:flex-end;">
          ${statusBadge}
          ${actionHtml}
        </div>
      </div>`;
      list.appendChild(d);
    });
  }

  // ─── 내 신청 현황 (날짜+시간 오름차순 정렬, 지난 일정은 옅게) ───
  const items = Object.entries(u.applications || {}).filter(([,v]) => v);
  if (!items.length) {
    myApp.innerHTML = '<p class="empty-msg">신청한 항목이 없습니다.</p>';
    return;
  }
  const myItems = items
    .map(([evId, status]) => ({ evId, status, ev: S.events.find(e => e._id === evId) }))
    .filter(x => x.ev)
    .sort((a, b) => {
      const ka = (a.ev.date || '') + 'T' + (a.ev.startTime || '00:00');
      const kb = (b.ev.date || '') + 'T' + (b.ev.startTime || '00:00');
      return ka.localeCompare(kb);
    });

  myApp.innerHTML = '';
  myItems.forEach(({ evId, status, ev }) => {
    const timeStr = fmtTime(ev.startTime, ev.endTime);
    const isPast = ev.date < todayStr;
    const isClosed = ev.status === 'closed';
    const d = document.createElement('div'); d.className = 'ev-item';
    if (isPast || isClosed) d.style.opacity = '0.55';
    const badgeText = status==='pending' ? '검토중'
                    : status==='approved' ? '승인됨'
                    : '✨ 다음 기회에';
    const titleSuffix = isPast ? ' <span style="font-size:11px;color:var(--text-hint);">(종료)</span>'
                     : isClosed ? ' <span style="font-size:11px;color:var(--text-sub);">(마감)</span>'
                     : '';
    const cancelBtn = (isPast || isClosed) ? '' : `<button class="btn sm danger" onclick="cancelApp('${evId}')">취소</button>`;
    d.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
      <span style="display:flex;align-items:center;flex:1;min-width:0;">
        <span class="type-stripe ${typeCls(ev.type)}"></span>
        <span style="overflow:hidden;text-overflow:ellipsis;">[${ev.type}] ${ev.title} <span style="color:var(--text-sub);">${ev.date}${timeStr ? ' ' + timeStr : ''}</span>${titleSuffix}</span>
      </span>
      <div class="btn-grp">
        <span class="badge ${status}">${badgeText}</span>
        ${cancelBtn}
      </div>
    </div>`;
    myApp.appendChild(d);
  });
}

async function applyEv(evId) {
  const u = S.instructors[S.currentUser];
  if (!u) return;
  const ev = S.events.find(e => e._id === evId);
  if (ev && ev.status === 'closed') {
    toast('이 일정은 모집이 마감되었습니다.', 'error');
    return;
  }
  const apps = { ...(u.applications || {}) };
  apps[evId] = 'pending';
  try {
    await window.DB.updateInstructor(S.currentUser, { applications: apps });
    u.applications = apps;
    renderInstEvents();
  } catch(e) {
    toast('신청 실패: ' + e.message, 'error');
  }
}

async function cancelApp(evId) {
  const ev = S.events.find(e => e._id === evId);
  if (!ev) return;
  if (ev.status === 'closed') {
    toast('이 일정은 모집이 마감되어 취소할 수 없습니다.', 'error');
    return;
  }
  if (!confirm(`'${ev.title}' 신청을 취소하시겠습니까?`)) return;
  const u = S.instructors[S.currentUser];
  if (!u) return;
  const apps = { ...(u.applications || {}) };
  delete apps[evId];
  try {
    await window.DB.updateInstructor(S.currentUser, { applications: apps });
    u.applications = apps;
    renderInstEvents();
  } catch(e) {
    toast('취소 실패: ' + e.message, 'error');
  }
}

function updatePendingBadge() {
  const badge = document.getElementById('pendingBadge');
  if (!badge) return;
  const count = Object.values(S.instructors)
    .filter(u => (u.status || 'approved') === 'pending').length;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-flex';
  } else {
    badge.textContent = '';
    badge.style.display = 'none';
  }
}

function renderApprovalList() {
  const pendingDiv = document.getElementById('pendingInstList');
  const rejectedDiv = document.getElementById('rejectedInstList');
  const pendingCountText = document.getElementById('pendingCountText');
  const rejectedCountText = document.getElementById('rejectedCountText');
  if (!pendingDiv || !rejectedDiv) return;

  const pending = [];
  const rejected = [];
  Object.entries(S.instructors).forEach(([name, rawU]) => {
    const u = getProfile(rawU);
    if (u.status === 'pending') pending.push({ name, u });
    if (u.status === 'rejected') rejected.push({ name, u });
  });

  pending.sort((a, b) => (a.u.registeredAt || '').localeCompare(b.u.registeredAt || ''));
  rejected.sort((a, b) => (b.u.rejectedAt || '').localeCompare(a.u.rejectedAt || ''));

  pendingCountText.textContent = pending.length ? `${pending.length}건 대기 중` : '';
  rejectedCountText.textContent = rejected.length ? `${rejected.length}건` : '';

  if (!pending.length) {
    pendingDiv.innerHTML = '<p class="empty-msg">✨ 승인 대기 중인 신청이 없습니다.</p>';
  } else {
    pendingDiv.innerHTML = '';
    pending.forEach(({ name, u }) => {
      const time = u.registeredAt ? new Date(u.registeredAt).toLocaleString('ko-KR') : '-';
      const display = u.displayName || u.baseName || name;
      const avatarChar = (u.baseName || name).slice(0,1);
      const row = document.createElement('div');
      row.className = 'row-item';
      row.style.flexWrap = 'wrap';
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
          <div class="avatar" style="background:var(--amber-light);color:var(--amber);">${_escapeHtml(avatarChar)}</div>
          <div class="inst-info">
            <div class="inst-name">
              ${_escapeHtml(display)}
              <span class="badge pending" style="margin-left:6px;">대기중</span>
            </div>
            <div class="inst-sub">📅 신청 시각: ${time}</div>
          </div>
        </div>
        <div class="btn-grp">
          <button class="btn sm green" onclick="approveInstructor('${name.replace(/'/g, "\\'")}')">✓ 승인</button>
          <button class="btn sm danger" onclick="rejectInstructor('${name.replace(/'/g, "\\'")}')">✗ 거절</button>
        </div>
      `;
      pendingDiv.appendChild(row);
    });
  }

  if (!rejected.length) {
    rejectedDiv.innerHTML = '<p class="empty-msg">거절된 신청이 없습니다.</p>';
  } else {
    rejectedDiv.innerHTML = '';
    rejected.forEach(({ name, u }) => {
      const rTime = u.rejectedAt ? new Date(u.rejectedAt).toLocaleString('ko-KR') : '-';
      const display = u.displayName || u.baseName || name;
      const avatarChar = (u.baseName || name).slice(0,1);
      const row = document.createElement('div');
      row.className = 'row-item';
      row.style.flexWrap = 'wrap';
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
          <div class="avatar" style="background:var(--red-light);color:var(--red);">${_escapeHtml(avatarChar)}</div>
          <div class="inst-info">
            <div class="inst-name">
              ${_escapeHtml(display)}
              <span class="badge rejected" style="margin-left:6px;">거절됨</span>
            </div>
            <div class="inst-sub">📅 거절 시각: ${rTime}${u.rejectedBy ? ' · 처리자: ' + _escapeHtml(u.rejectedBy) : ''}</div>
          </div>
        </div>
        <div class="btn-grp">
          <button class="btn sm green" onclick="approveInstructor('${name.replace(/'/g, "\\'")}')">↻ 다시 승인</button>
          <button class="btn sm danger" onclick="deleteInst('${name.replace(/'/g, "\\'")}')">🗑 완전 삭제</button>
        </div>
      `;
      rejectedDiv.appendChild(row);
    });
  }

  updatePendingBadge();
}

async function approveInstructor(name) {
  if (!S.instructors[name]) return;
  const cur = getProfile(S.instructors[name]);
  const wasRejected = cur.status === 'rejected';
  const msg = wasRejected
    ? `'${name}' 강사를 다시 승인하시겠습니까?`
    : `'${name}' 강사 가입 신청을 승인하시겠습니까?`;
  if (!confirm(msg)) return;

  try {
    showLoading('승인 처리 중...');
    const updateData = {
      status: 'approved',
      approvedAt: new Date().toISOString(),
      approvedBy: S.currentAdminName || ''
    };
    await window.DB.updateInstructor(name, updateData);
    S.instructors[name] = { ...S.instructors[name], ...updateData };
    hideLoading();
    toast(`✓ '${name}' 강사가 승인되었습니다`, 'success');
    renderApprovalList();
    updatePendingBadge();
  } catch(e) {
    hideLoading();
    toast('승인 실패: ' + e.message, 'error');
  }
}

async function rejectInstructor(name) {
  if (!S.instructors[name]) return;
  if (!confirm(`'${name}' 강사 가입 신청을 거절하시겠습니까?`)) return;

  try {
    showLoading('처리 중...');
    const updateData = {
      status: 'rejected',
      rejectedAt: new Date().toISOString(),
      rejectedBy: S.currentAdminName || ''
    };
    await window.DB.updateInstructor(name, updateData);
    S.instructors[name] = { ...S.instructors[name], ...updateData };
    hideLoading();
    toast(`'${name}' 강사 신청이 거절되었습니다`, 'success');
    renderApprovalList();
    updatePendingBadge();
  } catch(e) {
    hideLoading();
    toast('처리 실패: ' + e.message, 'error');
  }
}

function renderCal() {
  document.getElementById('calTitle').textContent = `${S.calYear}년 ${MON[S.calMonth]}`;
  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';
  ['일','월','화','수','목','금','토'].forEach(d => {
    const h = document.createElement('div'); h.className = 'cal-day-hdr'; h.textContent = d; grid.appendChild(h);
  });
  const first = new Date(S.calYear, S.calMonth, 1).getDay();
  const days = new Date(S.calYear, S.calMonth + 1, 0).getDate();
  for (let i = 0; i < first; i++) {
    const d = document.createElement('div'); d.className = 'cal-day other-month'; grid.appendChild(d);
  }
  const today = new Date();
  for (let d = 1; d <= days; d++) {
    const cell = document.createElement('div'); cell.className = 'cal-day';
    if (d === today.getDate() && S.calMonth === today.getMonth() && S.calYear === today.getFullYear()) cell.classList.add('today');
    cell.innerHTML = `<div class="day-num">${d}</div>`;
    const ds = `${S.calYear}-${String(S.calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayEvs = S.events.filter(e => e.date === ds);
    dayEvs.slice(0, 2).forEach(ev => {
      const dot = document.createElement('span');
      dot.className = 'ev-dot ' + typeCls(ev.type);
      dot.textContent = `[${ev.type}] ${ev.title}`;
      dot.onclick = (e) => { e.stopPropagation(); openEvDetail(ev._id); };
      dot.style.cursor = 'pointer';
      cell.appendChild(dot);
    });
    if (dayEvs.length > 2) {
      const more = document.createElement('span');
      more.className = 'ev-dot type-etc';
      more.textContent = `+${dayEvs.length - 2}건 더`;
      more.onclick = (e) => { e.stopPropagation(); openEvDetail(dayEvs[2]._id); };
      more.style.cursor = 'pointer';
      cell.appendChild(more);
    }
    // ─── 사무실 방문 신청 표시 (관리자 = 전체 강사) ───
    const dayVisits = (S.visits || []).filter(v => v.date === ds);
    dayVisits.slice(0, 2).forEach(v => {
      const vdot = document.createElement('span');
      vdot.className = 'visit-dot ' + (v.status || 'pending');
      vdot.textContent = `🏢 ${v.time || ''} ${v.instructor}`;
      vdot.onclick = (e) => { e.stopPropagation(); openVisitReview(v._id); };
      vdot.style.cursor = 'pointer';
      cell.appendChild(vdot);
    });
    if (dayVisits.length > 2) {
      const vmore = document.createElement('span');
      vmore.className = 'visit-dot pending';
      vmore.textContent = `+ 방문 ${dayVisits.length - 2}건`;
      vmore.onclick = (e) => {
        e.stopPropagation();
        const btn = document.querySelector('#adminNav .nav-btn[onclick*="Visits"]');
        showAP('Visits', btn);
      };
      vmore.style.cursor = 'pointer';
      cell.appendChild(vmore);
    }
    cell.onclick = () => {
      const isMobile = window.innerWidth <= 600;
      if (isMobile) {
        showMobileDayEvents(ds, dayEvs);
      } else {
        document.getElementById('evDate').value = ds;
        openAddEventForCreate();
      }
    };
    grid.appendChild(cell);
  }
  renderMonthList();
}

function showMobileDayEvents(ds, dayEvs) {
  const wrap = document.getElementById('mobileDayEvents');
  const titleEl = document.getElementById('mobileDayEventsTitle');
  const listEl = document.getElementById('mobileDayEventsList');
  if (!wrap || !titleEl || !listEl) return;

  const dt = new Date(ds + 'T00:00:00');
  const dayLabel = ['일','월','화','수','목','금','토'][dt.getDay()];
  titleEl.textContent = `📅 ${ds} (${dayLabel}) — ${dayEvs.length}건`;

  if (!dayEvs.length) {
    listEl.innerHTML = `
      <p class="empty-msg" style="margin-bottom:10px;">이 날짜에 일정이 없습니다.</p>
      <button class="btn sm primary" style="width:100%;" onclick="document.getElementById('evDate').value='${ds}';openAddEventForCreate();">+ 이 날짜에 일정 추가</button>`;
  } else {
    listEl.innerHTML = '';
    dayEvs.forEach(ev => {
      const apps = Object.values(S.instructors).filter(u => u.applications && u.applications[ev._id]);
      const approved = apps.filter(u => u.applications[ev._id] === 'approved').length;
      const timeStr = fmtTime(ev.startTime, ev.endTime);
      const card = document.createElement('div');
      card.className = 'notice-card';
      card.style.borderLeftColor = ({
        '과학&코딩 캠프': '#186E48',
        '특강수업': '#0F6E56',
        '세미나&연수': '#854F0B',
        '동아리': '#6B3FA0',
        '기타사항': '#999'
      })[ev.type] || '#999';
      card.innerHTML = `
        <div class="notice-title-row">
          <span class="badge ${typeCls(ev.type)}" style="font-size:10px;">${ev.type}</span>
          <span class="notice-title">${_escapeHtml(ev.title)}</span>
        </div>
        <div class="notice-meta">
          ${timeStr ? `<span>🕒 ${timeStr}</span>` : ''}
          <span>📍 ${_escapeHtml(ev.place || '-')}</span>
          <span>👥 ${apps.length}명${approved ? ` (✓${approved})` : ''}</span>
        </div>
      `;
      card.onclick = () => openEvDetail(ev._id);
      listEl.appendChild(card);
    });
    const addBtn = document.createElement('button');
    addBtn.className = 'btn primary';
    addBtn.style.cssText = 'width:100%;margin-top:10px;';
    addBtn.textContent = `+ 이 날짜에 일정 추가`;
    addBtn.onclick = () => {
      document.getElementById('evDate').value = ds;
      openAddEventForCreate();
    };
    listEl.appendChild(addBtn);
  }

  wrap.classList.add('show');
  setTimeout(() => wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
}

function chMon(d) {
  S.calMonth += d;
  if (S.calMonth > 11) { S.calMonth = 0; S.calYear++; }
  if (S.calMonth < 0) { S.calMonth = 11; S.calYear--; }
  renderCal();
}

function renderMonthList() {
  const pfx = `${S.calYear}-${String(S.calMonth+1).padStart(2,'0')}`;
  const evs = S.events.filter(e => e.date.startsWith(pfx));
  const div = document.getElementById('monthEvList');
  if (!evs.length) { div.innerHTML = '<p class="empty-msg">이번 달 일정이 없습니다.</p>'; return; }
  evs.sort((a,b) => (a.date+'T'+(a.startTime||'00:00')).localeCompare(b.date+'T'+(b.startTime||'00:00')));
  div.innerHTML = '';
  evs.forEach(ev => {
    const apps = Object.values(S.instructors).filter(u => u.applications && u.applications[ev._id]);
    const approved = apps.filter(u => u.applications[ev._id] === 'approved').length;
    const timeStr = fmtTime(ev.startTime, ev.endTime);
    const d = document.createElement('div'); d.className = 'ev-item';
    d.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <div style="display:flex;align-items:flex-start;flex:1;min-width:0;">
        <span class="type-stripe ${typeCls(ev.type)}"></span>
        <div style="flex:1;min-width:0;">
          <div class="ev-title">[${ev.type}] ${ev.title}</div>
          <div class="ev-meta">${ev.date}${timeStr ? ' · ' + timeStr : ''} &middot; ${ev.place} &middot; 신청 ${apps.length}명 / 승인 ${approved}명</div>
        </div>
      </div>
      <button class="btn sm" onclick="openEvDetail('${ev._id}')">상세</button>
    </div>`;
    div.appendChild(d);
  });
}

function renderAdminSchedule() {
  const list = document.getElementById('adminScheduleList');
  const summary = document.getElementById('adminScheduleSummary');
  if (!list) return;

  const qTitle = (document.getElementById('schSearchTitle')?.value || '').trim().toLowerCase();
  const qType = document.getElementById('schFilterType')?.value || '';
  const qPeriod = document.getElementById('schFilterPeriod')?.value || 'upcoming';
  const sortBy = document.getElementById('schSortBy')?.value || 'dateAsc';

  const todayStr = (() => {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  })();

  const now = new Date();
  const dow = now.getDay();
  const daysToMon = (dow === 0 ? -6 : 1 - dow);
  const monday = new Date(now); monday.setDate(now.getDate() + daysToMon);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  const fmtYmd = (d) => {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  };
  const weekStart = fmtYmd(monday);
  const weekEnd = fmtYmd(sunday);
  const monthPfx = todayStr.slice(0, 7);

  let filtered = S.events.filter(ev => {
    if (qTitle) {
      const hay = (ev.title || '').toLowerCase() + ' ' + (ev.place || '').toLowerCase() + ' ' + (ev.desc || '').toLowerCase();
      if (!hay.includes(qTitle)) return false;
    }
    if (qType && ev.type !== qType) return false;
    if (qPeriod === 'upcoming' && ev.date < todayStr) return false;
    if (qPeriod === 'past' && ev.date >= todayStr) return false;
    if (qPeriod === 'thisMonth' && !ev.date.startsWith(monthPfx)) return false;
    if (qPeriod === 'thisWeek' && (ev.date < weekStart || ev.date > weekEnd)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    const ka = a.date + 'T' + (a.startTime || '00:00');
    const kb = b.date + 'T' + (b.startTime || '00:00');
    return sortBy === 'dateDesc' ? kb.localeCompare(ka) : ka.localeCompare(kb);
  });

  const totalAll = S.events.length;
  summary.textContent = filtered.length ? `${filtered.length}건 표시 중 (전체 ${totalAll}건)` : `결과 없음 (전체 ${totalAll}건)`;

  if (!filtered.length) {
    list.innerHTML = '<p class="empty-msg">조건에 맞는 일정이 없습니다.</p>';
    return;
  }

  const grouped = {};
  filtered.forEach(ev => {
    if (!grouped[ev.date]) grouped[ev.date] = [];
    grouped[ev.date].push(ev);
  });
  const dates = Object.keys(grouped);
  dates.sort((a, b) => sortBy === 'dateDesc' ? b.localeCompare(a) : a.localeCompare(b));

  list.innerHTML = '';
  dates.forEach(date => {
    const isToday = date === todayStr;
    const isPast = date < todayStr;
    const dateD = new Date(date + 'T00:00:00');
    const dayLabel = ['일','월','화','수','목','금','토'][dateD.getDay()];
    const header = document.createElement('div');
    header.style.cssText = 'font-size:12px;font-weight:700;color:var(--text-sub);margin:14px 0 6px;padding-bottom:4px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:6px;';
    header.innerHTML = `${date} (${dayLabel})${isToday ? ' <span style="color:var(--blue);font-weight:700;">오늘</span>' : ''}${isPast && !isToday ? ' <span style="color:var(--text-hint);font-weight:400;">— 지남</span>' : ''}`;
    list.appendChild(header);

    grouped[date].forEach(ev => {
      const apps = Object.values(S.instructors).filter(u => u.applications && u.applications[ev._id]);
      const approved = apps.filter(u => u.applications[ev._id] === 'approved').length;
      const pending = apps.filter(u => u.applications[ev._id] === 'pending').length;
      const rejected = apps.filter(u => u.applications[ev._id] === 'rejected').length;
      const timeStr = fmtTime(ev.startTime, ev.endTime);
      const isClosed = ev.status === 'closed';

      const card = document.createElement('div');
      card.className = 'notice-card priority-normal-border';
      card.style.borderLeftColor = ({
        '과학&코딩 캠프': '#186E48',
        '특강수업': '#0F6E56',
        '세미나&연수': '#854F0B',
        '동아리': '#6B3FA0',
        '기타사항': '#999'
      })[ev.type] || '#999';
      if (isPast && !isToday) card.style.opacity = '0.7';
      if (isClosed) card.style.opacity = '0.7';

      const closedBadge = isClosed
        ? `<span class="badge" style="background:var(--bg);color:var(--text-sub);border:1px solid var(--border);">🔒 모집 마감</span>`
        : '';

      card.innerHTML = `
        <div class="notice-title-row">
          <span class="badge" style="background:#${({'과학&코딩 캠프':'E1F1E8','특강수업':'E1F5EE','세미나&연수':'FAEEDA','동아리':'F0E7FA','기타사항':'ECECEC'})[ev.type]||'ECECEC'};color:${({'과학&코딩 캠프':'#186E48','특강수업':'#0F6E56','세미나&연수':'#854F0B','동아리':'#6B3FA0','기타사항':'#555'})[ev.type]||'#555'};">${ev.type}</span>
          ${closedBadge}
          <span class="notice-title">${_escapeHtml(ev.title)}</span>
        </div>
        <div class="notice-meta">
          ${timeStr ? `<span>🕒 ${timeStr}</span>` : ''}
          <span>📍 ${_escapeHtml(ev.place || '-')}</span>
          <span>👥 신청 ${apps.length}명${approved ? ` (✓${approved})` : ''}${pending ? ` (검토중 ${pending})` : ''}${rejected ? ` (✨ 다음기회 ${rejected})` : ''}</span>
        </div>
        ${ev.desc ? `<div class="notice-preview" style="margin-top:6px;">${_escapeHtml(ev.desc)}</div>` : ''}
      `;
      card.onclick = () => openEvDetail(ev._id);
      list.appendChild(card);
    });
  });
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function openAddEventForCreate() {
  S.editingEventIdx = null;
  document.getElementById('addEvTitle').textContent = '일정 / 공지 추가';
  ['evTitle','evPlace','evDesc','evStart','evEnd'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('evType').selectedIndex = 0;
  openModal('addEvModal');
}

function openAddEventForEdit(evId) {
  const ev = S.events.find(e => e._id === evId);
  if (!ev) return;
  S.editingEventIdx = evId;
  document.getElementById('addEvTitle').textContent = '일정 / 공지 수정';
  document.getElementById('evType').value = ev.type;
  document.getElementById('evTitle').value = ev.title || '';
  document.getElementById('evDate').value = ev.date || '';
  document.getElementById('evStart').value = ev.startTime || '';
  document.getElementById('evEnd').value = ev.endTime || '';
  document.getElementById('evPlace').value = ev.place || '';
  document.getElementById('evDesc').value = ev.desc || '';
  closeModal('evDetailModal');
  openModal('addEvModal');
}

function closeAddEvModal() {
  S.editingEventIdx = null;
  closeModal('addEvModal');
}

async function saveEvent() {
  const title = document.getElementById('evTitle').value.trim();
  const date = document.getElementById('evDate').value;
  const startTime = document.getElementById('evStart').value;
  const endTime = document.getElementById('evEnd').value;
  if (!title || !date) { alert('제목과 날짜를 입력하세요.'); return; }
  if (startTime && endTime && startTime > endTime) {
    alert('종료 시간은 시작 시간보다 빠를 수 없습니다.'); return;
  }
  const data = {
    type: document.getElementById('evType').value,
    title, date, startTime, endTime,
    place: document.getElementById('evPlace').value,
    desc: document.getElementById('evDesc').value
  };

  showLoading('저장 중...');
  try {
    if (S.editingEventIdx !== null) {
      await window.DB.updateEvent(S.editingEventIdx, data);
      // 낙관적 UI 갱신 (수정 — 기존 필드 보존)
      const idx = S.events.findIndex(e => e._id === S.editingEventIdx);
      if (idx >= 0) S.events[idx] = { ...S.events[idx], ...data };
    } else {
      const newId = await window.DB.addEvent(data);
      // 낙관적 UI 갱신 (신규 추가)
      if (newId && !S.events.some(e => e._id === newId)) {
        S.events.push({ _id: newId, ...data });
      }
    }
    hideLoading();
    closeAddEvModal();
    onDataChanged('events');
  } catch(e) {
    hideLoading();
    toast('일정 저장 실패: ' + e.message, 'error');
  }
}

function openEvDetail(evId) {
  const ev = S.events.find(e => e._id === evId);
  if (!ev) return;
  document.getElementById('edTitle').textContent = `[${ev.type}] ${ev.title}`;
  const timeStr = fmtTime(ev.startTime, ev.endTime);
  document.getElementById('edInfo').textContent = `${ev.date}${timeStr ? ' · ' + timeStr : ''} · ${ev.place}`;
  document.getElementById('edDesc').textContent = ev.desc || '';

  // 모집 상태 처리
  const isClosed = ev.status === 'closed';
  const closedNotice = document.getElementById('edClosedNotice');
  const closeBtn = document.getElementById('closeEvBtn');
  if (isClosed) {
    closedNotice.style.display = '';
    const meta = ev.closedAt
      ? `· ${new Date(ev.closedAt).toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })}${ev.closedBy ? ' · ' + _escapeHtml(ev.closedBy) : ''}`
      : '';
    document.getElementById('edClosedMeta').textContent = meta;
    closeBtn.textContent = '🔓 마감 취소';
    closeBtn.style.background = 'var(--amber-light)';
    closeBtn.style.color = 'var(--amber)';
    closeBtn.style.borderColor = 'rgba(133,79,11,0.25)';
    closeBtn.onclick = () => reopenEvent(evId);
  } else {
    closedNotice.style.display = 'none';
    closeBtn.textContent = '확정 완료 ✓';
    closeBtn.style.background = 'var(--blue-light)';
    closeBtn.style.color = 'var(--blue-dark)';
    closeBtn.style.borderColor = 'rgba(24,110,72,0.25)';
    closeBtn.onclick = () => closeEvent(evId);
  }

  const apDiv = document.getElementById('edApplicants');
  const applicants = [];
  Object.entries(S.instructors).forEach(([name, u]) => {
    if (u.applications && u.applications[evId]) applicants.push({ name, status: u.applications[evId] });
  });
  document.getElementById('delEvBtn').onclick = () => deleteEvent(evId);
  document.getElementById('editEvBtn').onclick = () => openAddEventForEdit(evId);
  if (!applicants.length) {
    apDiv.innerHTML = '<p class="empty-msg">신청한 강사가 없습니다.</p>';
  } else {
    apDiv.innerHTML = '';
    applicants.forEach(({ name, status }) => {
      const row = document.createElement('div'); row.className = 'app-row';
      const badgeText = status==='pending' ? '검토중'
                      : status==='approved' ? '승인됨'
                      : '다음 기회에';
      // 마감 후에도 관리자가 추가로 승인/거절 변경 가능 (실수 보정용)
      row.innerHTML = `<span>${name}</span>
        <div class="btn-grp">
          <span class="badge ${status}">${badgeText}</span>
          ${status==='pending'
            ? `<button class="btn sm primary" onclick="approveApp('${name}','${evId}','approved')">승인</button>
               <button class="btn sm" style="background:var(--amber-light);color:var(--amber);border-color:rgba(133,79,11,0.25);" onclick="approveApp('${name}','${evId}','rejected')">다음 기회로</button>`
            : ''}
        </div>`;
      apDiv.appendChild(row);
    });
  }
  openModal('evDetailModal');
}

// 일정 모집 마감 처리
async function closeEvent(evId) {
  const ev = S.events.find(e => e._id === evId);
  if (!ev) return;

  // 미처리(검토중) 신청 카운트
  const pendingNames = Object.entries(S.instructors)
    .filter(([_, u]) => u.applications && u.applications[evId] === 'pending')
    .map(([name]) => name);
  const pendingCount = pendingNames.length;

  let msg;
  if (pendingCount > 0) {
    const namesList = pendingNames.slice(0, 5).join(', ')
                    + (pendingNames.length > 5 ? ` 외 ${pendingNames.length - 5}명` : '');
    msg = `⚠️ 미처리 신청이 ${pendingCount}건 남아 있습니다.\n`
        + `(${namesList})\n\n`
        + `마감하기 전에 신청한 강사들을 모두\n`
        + `[승인] 또는 [다음 기회로] 처리해 주세요.\n\n`
        + `그래도 지금 마감하시겠습니까?\n`
        + `(미처리 상태로 남으면 강사가 결과를 알 수 없습니다)`;
  } else {
    msg = `이 일정의 모집을 마감합니다.\n\n`
        + `• 강사는 더 이상 신청·취소할 수 없게 됩니다.\n`
        + `• 승인/다음기회 결과는 그대로 유지됩니다.\n`
        + `• 필요 시 [마감 취소]로 다시 열 수 있습니다.\n\n`
        + `계속하시겠습니까?`;
  }

  if (!confirm(msg)) return;

  showLoading('마감 처리 중...');
  try {
    const patch = {
      status: 'closed',
      closedAt: new Date().toISOString(),
      closedBy: S.currentAdminName || ''
    };
    const { _id, ...rest } = ev;
    await window.DB.updateEvent(evId, { ...rest, ...patch });
    Object.assign(ev, patch);
    hideLoading();
    toast('모집이 마감되었습니다.', 'success');
    openEvDetail(evId);
  } catch(e) {
    hideLoading();
    toast('마감 실패: ' + e.message, 'error');
  }
}

// 일정 모집 마감 취소 (다시 열기)
async function reopenEvent(evId) {
  const ev = S.events.find(e => e._id === evId);
  if (!ev) return;
  if (!confirm('이 일정의 모집 마감을 취소하시겠습니까?\n다시 강사가 신청할 수 있게 됩니다.')) return;
  showLoading('처리 중...');
  try {
    const { _id, closedAt, closedBy, ...rest } = ev;
    await window.DB.updateEvent(evId, { ...rest, status: 'open' });
    ev.status = 'open';
    delete ev.closedAt;
    delete ev.closedBy;
    hideLoading();
    toast('모집이 다시 열렸습니다.', 'success');
    openEvDetail(evId);
  } catch(e) {
    hideLoading();
    toast('처리 실패: ' + e.message, 'error');
  }
}

async function approveApp(name, evId, result) {
  const u = S.instructors[name];
  if (!u) return;
  const apps = { ...(u.applications || {}) };
  apps[evId] = result;
  try {
    await window.DB.updateInstructor(name, { applications: apps });
    u.applications = apps;
    openEvDetail(evId);
  } catch(e) {
    toast('상태 변경 실패: ' + e.message, 'error');
  }
}

async function deleteEvent(evId) {
  if (!confirm('이 일정을 삭제하시겠습니까?')) return;
  showLoading('삭제 중...');
  try {
    for (const [name, u] of Object.entries(S.instructors)) {
      if (u.applications && u.applications[evId]) {
        const apps = { ...u.applications };
        delete apps[evId];
        await window.DB.updateInstructor(name, { applications: apps });
        u.applications = apps;  // 낙관적 UI
      }
    }
    await window.DB.deleteEvent(evId);
    // 낙관적 UI 갱신
    S.events = S.events.filter(e => e._id !== evId);
    hideLoading();
    closeModal('evDetailModal');
    toast('일정이 삭제되었습니다.', 'success');
    onDataChanged('events');
    onDataChanged('instructors');
  } catch(e) {
    hideLoading();
    toast('삭제 실패: ' + e.message, 'error');
  }
}

// 강사 목록 정렬 모드 ('recent' | 'name'). 기본값: 최근 등록순
let _instListSort = 'recent';

function _fmtRegDate(iso) {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  } catch(e) { return '-'; }
}

function setInstListSort(mode) {
  _instListSort = mode;
  renderInstList();
}

function renderInstList() {
  const div = document.getElementById('instListAdmin');
  if (!div) return;

  // ─── 검색 조건 수집 ─────────────────────────────
  const qName = (document.getElementById('sName')?.value || '').trim().toLowerCase();
  const qSubj = (document.getElementById('sSubject')?.value || '').trim().toLowerCase();
  const qEdu  = (document.getElementById('sEdu')?.value || '').trim().toLowerCase();
  const qCert = (document.getElementById('sCert')?.value || '').trim().toLowerCase();
  const activeDays = Object.keys(S.dayFilter || {}).filter(k => S.dayFilter[k]);
  const hasQuery = !!(qName || qSubj || qEdu || qCert || activeDays.length);

  // ─── 강사 필터 ─────────────────────────────────
  let names = Object.keys(S.instructors)
    .filter(name => (S.instructors[name].status || 'approved') === 'approved')
    .filter(name => {
      if (!hasQuery) return true;
      const u = getProfile(S.instructors[name]);
      if (qName && !name.toLowerCase().includes(qName)) return false;
      if (qSubj && !(u.subject||'').toLowerCase().includes(qSubj)) return false;
      if (qEdu  && !u.edu.some(e => e.toLowerCase().includes(qEdu))) return false;
      if (qCert && !u.certs.some(c => c.toLowerCase().includes(qCert))) return false;
      if (activeDays.length) {
        const hasDay = activeDays.every(key => u.days && u.days[key]);
        if (!hasDay) return false;
      }
      return true;
    });

  // ─── 정렬 ──────────────────────────────────────
  if (_instListSort === 'name') {
    names.sort((a, b) => a.localeCompare(b, 'ko'));
  } else {
    // 최근 등록순 (registeredAt 내림차순). registeredAt 없는 강사는 맨 뒤로.
    names.sort((a, b) => {
      const ra = S.instructors[a].registeredAt || '';
      const rb = S.instructors[b].registeredAt || '';
      if (!ra && !rb) return a.localeCompare(b, 'ko');
      if (!ra) return 1;
      if (!rb) return -1;
      return rb.localeCompare(ra);
    });
  }

  // ─── 정렬 토글 + 인원수 ────────────────────────
  const countLabel = hasQuery
    ? `검색 결과 ${names.length}명`
    : `총 ${names.length}명`;
  const sortBar = `
    <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;align-items:center;">
      <span style="font-size:12px;color:var(--text-sub);margin-right:4px;">정렬:</span>
      <button class="btn sm ${_instListSort==='recent'?'primary':''}" onclick="setInstListSort('recent')">최근 등록순</button>
      <button class="btn sm ${_instListSort==='name'?'primary':''}" onclick="setInstListSort('name')">가나다순</button>
      <span style="font-size:12px;color:${hasQuery?'var(--green)':'var(--text-hint)'};font-weight:${hasQuery?'600':'400'};margin-left:auto;">${countLabel}</span>
    </div>`;

  if (!names.length) {
    div.innerHTML = sortBar + `<p class="empty-msg">${hasQuery ? '검색 결과가 없습니다.' : '등록된 강사가 없습니다.'}</p>`;
    return;
  }

  div.innerHTML = sortBar;
  names.forEach(name => {
    const u = getProfile(S.instructors[name]);
    const regDate = _fmtRegDate(u.registeredAt);
    const display = u.displayName || u.baseName || name;
    const avatarChar = (u.baseName || name).slice(0,1);

    // 요일 태그는 요일 검색 조건이 있을 때만 표시
    let dayTagsHtml = '';
    if (activeDays.length) {
      const tags = DAYS.flatMap(d => {
        const ts = [];
        if (u.days[d.key+'_am']) ts.push(`<span class="badge" style="background:#E1F1E8;color:#186E48;margin-right:3px;font-size:10px;">${d.label} 오전</span>`);
        if (u.days[d.key+'_pm']) ts.push(`<span class="badge" style="background:var(--teal-light);color:var(--teal);margin-right:3px;font-size:10px;">${d.label} 오후</span>`);
        return ts;
      }).join('');
      if (tags) dayTagsHtml = `<div style="margin-top:4px;">${tags}</div>`;
    }

    const row = document.createElement('div'); row.className = 'row-item';
    row.style.flexWrap = 'wrap';
    row.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
        <div class="avatar">${avatarChar}</div>
        <div class="inst-info">
          <div class="inst-name">${_escapeHtml(display)} <span style="font-size:11px;color:var(--text-hint);font-weight:400;margin-left:4px;">📅 ${regDate}</span></div>
          <div class="inst-sub">${u.subject||'과목 미입력'} &middot; ${u.phone||'연락처 미입력'}</div>
          ${dayTagsHtml}
        </div>
      </div>
      <button class="btn sm" onclick="openProfile('${name.replace(/'/g, "\\'")}')">프로필</button>`;
    div.appendChild(row);
  });
}

// 검색 조건 초기화
function resetInstSearch() {
  ['sName','sSubject','sEdu','sCert'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  S.dayFilter = {};
  // 요일 버튼 시각 초기화
  document.querySelectorAll('#dayFilterBtns .day-filter-btn').forEach(b => {
    b.className = 'day-filter-btn';
  });
  renderInstList();
}

function initDayFilter() {
  const wrap = document.getElementById('dayFilterBtns');
  if (!wrap) return;
  wrap.innerHTML = '';
  DAYS.forEach(d => {
    ['오전','오후'].forEach(t => {
      const key = d.key + (t === '오전' ? '_am' : '_pm');
      const btn = document.createElement('button');
      btn.className = 'day-filter-btn' + (S.dayFilter && S.dayFilter[key] ? ' active-' + (t === '오전' ? 'am' : 'pm') : '');
      btn.textContent = `${d.label} ${t}`;
      btn.dataset.key = key;
      btn.dataset.type = t === '오전' ? 'am' : 'pm';
      btn.onclick = () => toggleDayFilter(key, btn);
      wrap.appendChild(btn);
    });
  });
}

function toggleDayFilter(key, btn) {
  if (S.dayFilter[key]) {
    delete S.dayFilter[key];
    btn.className = 'day-filter-btn';
  } else {
    S.dayFilter[key] = true;
    btn.className = 'day-filter-btn active-' + btn.dataset.type;
  }
  renderInstList();
}

// 기존 호출 호환용 — 강사 검색이 강사 목록으로 통합됨
function searchInst() {
  renderInstList();
}

function formatList(arr) {
  return (arr || []).filter(v => v.trim()).map(v => `<div style="padding:2px 0;">${v}</div>`).join('') || '-';
}

function openProfile(name) {
  const u = getProfile(S.instructors[name]);
  document.getElementById('pmAvatar').textContent = name.slice(0,1);
  document.getElementById('pmName').textContent = name;
  document.getElementById('pmSubject').textContent = u.subject || '과목 미입력';

  const dayStr = DAYS.flatMap(d => {
    const tags = [];
    if (u.days[d.key+'_am']) tags.push(`<span class="badge" style="background:#E1F1E8;color:#186E48;margin:1px;">${d.label} 오전</span>`);
    if (u.days[d.key+'_pm']) tags.push(`<span class="badge" style="background:var(--teal-light);color:var(--teal);margin:1px;">${d.label} 오후</span>`);
    return tags;
  }).join('') || '<span style="color:var(--text-hint)">미입력</span>';

  document.getElementById('pmInfo').innerHTML = `
    <div class="profile-section-title">기본 정보</div>
    <div class="profile-row"><span class="lbl">상태</span><span class="val"><span class="badge ${u.status}">${u.status==='approved'?'승인됨':u.status==='pending'?'대기중':'거절됨'}</span></span></div>
    <div class="profile-row"><span class="lbl">이메일</span><span class="val">${u.email||'-'}</span></div>
    <div class="profile-row"><span class="lbl">연락처</span><span class="val">${u.phone||'-'}</span></div>
    <div class="profile-row"><span class="lbl">주소</span><span class="val">${u.addr||'-'}</span></div>
    <div class="profile-row"><span class="lbl">학력(등급용)</span><span class="val">${u.eduLevel||'-'}</span></div>
    <div class="profile-row"><span class="lbl">전공(등급용)</span><span class="val">${u.isMajor === true ? '전공자' : u.isMajor === false ? '비전공자' : '-'}</span></div>
    <div class="profile-row"><span class="lbl">차량 유무</span><span class="val">${u.carOwn||'-'}</span></div>
    <div class="profile-section-title">학력(상세)</div>
    <div class="profile-row"><span class="val" style="min-width:0;">${formatList(u.edu)}</span></div>
    <div class="profile-section-title">경력</div>
    <div class="profile-row"><span class="val" style="min-width:0;">${formatList(u.career)}</span></div>
    <div class="profile-section-title">자격증</div>
    <div class="profile-row"><span class="val" style="min-width:0;">${formatList(u.certs)}</span></div>
    <div class="profile-section-title">수업 가능 요일</div>
    <div class="profile-row"><span class="val" style="min-width:0;flex-wrap:wrap;display:flex;gap:2px;">${dayStr}</span></div>
    <div class="profile-section-title">나를 어필해요</div>
    <div class="profile-row"><span class="val" style="min-width:0;white-space:pre-wrap;">${u.appeal||'-'}</span></div>`;

  const hist = document.getElementById('pmHistory');
  const items = Object.entries(u.applications || {}).filter(([,v]) => v);
  if (!items.length) {
    hist.innerHTML = '<p class="empty-msg">참여 이력이 없습니다.</p>';
  } else {
    hist.innerHTML = '';
    items.forEach(([evId, status]) => {
      const ev = S.events.find(e => e._id === evId);
      if (!ev) return;
      const timeStr = fmtTime(ev.startTime, ev.endTime);
      const d = document.createElement('div'); d.className = 'app-row';
      d.innerHTML = `<span style="display:flex;align-items:center;flex:1;min-width:0;">
          <span class="type-stripe ${typeCls(ev.type)}"></span>
          <span style="overflow:hidden;text-overflow:ellipsis;">[${ev.type}] ${ev.title} <span style="color:var(--text-sub);">${ev.date}${timeStr ? ' ' + timeStr : ''}</span></span>
        </span>
        <span class="badge ${status}">${status==='pending'?'검토중':status==='approved'?'승인됨':'✨ 다음 기회에'}</span>`;
      hist.appendChild(d);
    });
  }
  document.getElementById('delInstBtn').onclick = () => deleteInst(name);
  document.getElementById('resetInstPwBtn').onclick = () => resetInstPassword(name);
  openModal('profileModal');
}

async function deleteInst(name) {
  if (!confirm(`'${name}' 강사를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
  showLoading('삭제 중...');
  try {
    await window.DB.deleteInstructor(name);
    delete S.instructors[name];
    hideLoading();
    closeModal('profileModal');
    const apprPage = document.getElementById('apApproval');
    if (apprPage && apprPage.classList.contains('active')) renderApprovalList();
    const instListPage = document.getElementById('apInstructors');
    if (instListPage && instListPage.classList.contains('active')) renderInstList();
    updatePendingBadge();
  } catch(e) {
    hideLoading();
    toast('삭제 실패: ' + e.message, 'error');
  }
}

async function resetInstPassword(name) {
  const tempPw = name + '1234';
  if (!confirm(`'${name}' 강사의 비밀번호를 초기화하시겠습니까?\n\n임시 비밀번호: ${tempPw}`)) return;
  try {
    showLoading('비밀번호 초기화 중...');
    const hashed = await hashPw(tempPw);
    await window.DB.updateInstructor(name, { pw: hashed });
    if (S.instructors[name]) S.instructors[name].pw = hashed;
    hideLoading();
    alert(`✓ '${name}' 강사의 비밀번호가 초기화되었습니다.\n\n임시 비밀번호: ${tempPw}`);
    toast('비밀번호 초기화 완료', 'success');
  } catch(e) {
    hideLoading();
    toast('초기화 실패: ' + e.message, 'error');
  }
}

function renderAdminList() {
  const div = document.getElementById('adminList');
  div.innerHTML = '';
  Object.keys(S.admins).sort().forEach(name => {
    const isSelf = name === S.currentAdminName;
    const isProtected = (name === 'admin');
    const row = document.createElement('div'); row.className = 'admin-row';
    row.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="avatar" style="width:28px;height:28px;font-size:12px;">${name.slice(0,1)}</div>
        <span style="font-weight:500;">${name}</span>
        ${isSelf ? '<span class="badge admin" style="font-size:10px;">나</span>' : ''}
        ${isProtected ? '<span class="badge" style="font-size:10px;background:var(--bg);color:var(--text-sub);border:1px solid var(--border);">🔒 보호됨</span>' : ''}
      </div>
      <div>
        ${!isSelf && !isProtected && Object.keys(S.admins).length > 1
          ? `<button class="btn sm danger" onclick="deleteAdmin('${name.replace(/'/g, "\\'")}')">삭제</button>`
          : ''}
      </div>`;
    div.appendChild(row);
  });
}

async function addAdmin() {
  const name = document.getElementById('newAName').value.trim();
  const pw = document.getElementById('newAPw').value.trim();
  const err = document.getElementById('addAdminErr');
  if (!name || !pw) { err.textContent = '이름과 비밀번호를 입력하세요.'; err.style.display = 'block'; return; }
  if (Object.keys(S.admins).length >= 4) { err.textContent = '관리자는 최대 4명까지 등록 가능합니다.'; err.style.display = 'block'; return; }
  if (S.admins[name]) { err.textContent = '이미 존재하는 이름입니다.'; err.style.display = 'block'; return; }

  try {
    const hashed = await hashPw(pw);
    await window.DB.setAdmin(name, hashed);
    // 낙관적 UI 갱신
    S.admins = { ...S.admins, [name]: hashed };
    closeModal('addAdminModal');
    document.getElementById('newAName').value = '';
    document.getElementById('newAPw').value = '';
    err.style.display = 'none';
    toast('관리자가 추가되었습니다', 'success');
    onDataChanged('admins');
  } catch(e) {
    err.textContent = '추가 실패: ' + e.message;
    err.style.display = 'block';
  }
}

async function deleteAdmin(name) {
  if (name === 'admin') { toast("'admin' 계정은 삭제할 수 없습니다", 'error'); return; }
  if (!confirm(`'${name}' 관리자를 삭제하시겠습니까?`)) return;
  try {
    await window.DB.deleteAdmin(name);
    // 낙관적 UI 갱신
    const newAdmins = { ...S.admins };
    delete newAdmins[name];
    S.admins = newAdmins;
    toast('삭제되었습니다', 'success');
    onDataChanged('admins');
  } catch(e) {
    toast('삭제 실패: ' + e.message, 'error');
  }
}

async function changePw() {
  const cur = document.getElementById('curPw').value;
  const nw = document.getElementById('newPw').value;
  const nw2 = document.getElementById('newPw2').value;
  const msg = document.getElementById('pwMsg');

  try {
    const curHash = await hashPw(cur);
    if (S.admins[S.currentAdminName] !== curHash) {
      msg.textContent = '현재 비밀번호가 틀렸습니다.'; msg.style.color = 'var(--red)'; msg.style.display = 'inline'; return;
    }
    if (!nw) { msg.textContent = '새 비밀번호를 입력하세요.'; msg.style.color = 'var(--red)'; msg.style.display = 'inline'; return; }
    if (nw !== nw2) { msg.textContent = '새 비밀번호가 일치하지 않습니다.'; msg.style.color = 'var(--red)'; msg.style.display = 'inline'; return; }
    const newHash = await hashPw(nw);
    await window.DB.setAdmin(S.currentAdminName, newHash);
    msg.textContent = '✓ 비밀번호가 변경되었습니다.'; msg.style.color = 'var(--green)'; msg.style.display = 'inline';
    ['curPw','newPw','newPw2'].forEach(id => document.getElementById(id).value = '');
    setTimeout(() => msg.style.display = 'none', 3000);
  } catch(e) {
    msg.textContent = '오류: ' + e.message; msg.style.color = 'var(--red)'; msg.style.display = 'inline';
  }
}

const PRIORITY_LABEL = { normal: '일반', important: '중요', urgent: '긴급' };
const PRIORITY_RANK = { urgent: 0, important: 1, normal: 2 };
const PRIORITY_BORDER_CLASS = {
  urgent: 'priority-urgent-border',
  important: 'priority-important-border',
  normal: 'priority-normal-border'
};

function _priorityBadgeHtml(p) {
  return `<span class="priority-badge priority-${p}">${PRIORITY_LABEL[p] || '일반'}</span>`;
}

function _formatNoticeDate(iso) {
  if (!iso) return '';
  try { return _fmtDateTime(new Date(iso)); } catch(e) { return iso; }
}

function _sortNotices(arr) {
  return [...arr].sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] ?? 9;
    const pb = PRIORITY_RANK[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
}

function renderInstNotices() {
  const list = document.getElementById('instNoticeList');
  const count = document.getElementById('instNoticeCount');
  if (!list) return;
  const sorted = _sortNotices(S.notices);
  count.textContent = sorted.length ? `총 ${sorted.length}개` : '';
  if (!sorted.length) {
    list.innerHTML = '<p class="empty-msg">등록된 공지사항이 없습니다.</p>';
    return;
  }
  list.innerHTML = '';
  sorted.forEach(n => {
    const card = document.createElement('div');
    card.className = 'notice-card ' + (PRIORITY_BORDER_CLASS[n.priority] || PRIORITY_BORDER_CLASS.normal);
    const commentCount = (n.comments || []).length;
    card.innerHTML = `
      <div class="notice-title-row">
        ${_priorityBadgeHtml(n.priority || 'normal')}
        <span class="notice-title">${_escapeHtml(n.title)}</span>
      </div>
      <div class="notice-meta">
        <span>✍️ ${_escapeHtml(n.author || '-')}</span>
        <span>🕒 ${_formatNoticeDate(n.createdAt)}</span>
        ${commentCount ? `<span>💬 ${commentCount}</span>` : ''}
      </div>
    `;
    card.onclick = () => openNoticeDetail(n._id);
    list.appendChild(card);
  });
}

function renderAdminNotices() {
  const list = document.getElementById('adminNoticeList');
  if (!list) return;
  const sorted = _sortNotices(S.notices);
  if (!sorted.length) {
    list.innerHTML = '<p class="empty-msg">등록된 공지사항이 없습니다.</p>';
    return;
  }
  list.innerHTML = '';
  sorted.forEach(n => {
    const card = document.createElement('div');
    card.className = 'notice-card ' + (PRIORITY_BORDER_CLASS[n.priority] || PRIORITY_BORDER_CLASS.normal);
    const commentCount = (n.comments || []).length;
    card.innerHTML = `
      <div class="notice-title-row">
        ${_priorityBadgeHtml(n.priority || 'normal')}
        <span class="notice-title">${_escapeHtml(n.title)}</span>
      </div>
      <div class="notice-meta">
        <span>✍️ ${_escapeHtml(n.author || '-')}</span>
        <span>🕒 ${_formatNoticeDate(n.createdAt)}</span>
        ${commentCount ? `<span>💬 ${commentCount}개의 댓글</span>` : ''}
      </div>
    `;
    card.onclick = () => openNoticeDetail(n._id);
    list.appendChild(card);
  });
}

function openNoticeForm() {
  S.editingNoticeId = null;
  document.getElementById('noticeFormTitle').textContent = '새 공지 작성';
  document.getElementById('noticePriority').value = 'normal';
  document.getElementById('noticeTitle').value = '';
  document.getElementById('noticeContent').value = '';
  openModal('noticeFormModal');
}

function openNoticeFormForEdit(noticeId) {
  const n = S.notices.find(x => x._id === noticeId);
  if (!n) return;
  S.editingNoticeId = noticeId;
  document.getElementById('noticeFormTitle').textContent = '공지 수정';
  document.getElementById('noticePriority').value = n.priority || 'normal';
  document.getElementById('noticeTitle').value = n.title || '';
  document.getElementById('noticeContent').value = n.content || '';
  closeModal('noticeDetailModal');
  openModal('noticeFormModal');
}

function closeNoticeForm() {
  S.editingNoticeId = null;
  closeModal('noticeFormModal');
}

async function saveNotice() {
  const title = document.getElementById('noticeTitle').value.trim();
  const content = document.getElementById('noticeContent').value.trim();
  const priority = document.getElementById('noticePriority').value;
  if (!title) { alert('제목을 입력하세요.'); return; }
  if (!content) { alert('내용을 입력하세요.'); return; }

  showLoading('저장 중...');
  try {
    if (S.editingNoticeId) {
      const existing = S.notices.find(n => n._id === S.editingNoticeId);
      const data = {
        ...(existing || {}),
        title, content, priority,
        updatedAt: new Date().toISOString(),
        updatedBy: S.currentAdminName || ''
      };
      delete data._id;
      await window.DB.updateNotice(S.editingNoticeId, data);
      // 낙관적 UI 갱신
      const idx = S.notices.findIndex(n => n._id === S.editingNoticeId);
      if (idx >= 0) S.notices[idx] = { _id: S.editingNoticeId, ...data };
    } else {
      const data = {
        title, content, priority,
        author: S.currentAdminName || '관리자',
        createdAt: new Date().toISOString(),
        comments: []
      };
      const newId = await window.DB.addNotice(data);
      // 낙관적 UI 갱신
      if (newId && !S.notices.some(n => n._id === newId)) {
        S.notices.push({ _id: newId, ...data });
      }
    }
    hideLoading();
    closeNoticeForm();
    toast(S.editingNoticeId ? '수정되었습니다' : '공지가 등록되었습니다', 'success');
    onDataChanged('notices');  // 활성 페이지 일괄 갱신
  } catch(e) {
    hideLoading();
    toast('저장 실패: ' + e.message, 'error');
  }
}

function openNoticeDetail(noticeId) {
  const n = S.notices.find(x => x._id === noticeId);
  if (!n) { toast('공지를 찾을 수 없습니다', 'error'); return; }
  S.currentNoticeId = noticeId;
  renderNoticeDetail(n);
  openModal('noticeDetailModal');
}

function renderNoticeDetail(n) {
  document.getElementById('ndPriority').innerHTML = _priorityBadgeHtml(n.priority || 'normal');
  document.getElementById('ndTitle').textContent = n.title || '';
  let metaText = `✍️ ${n.author || '-'}  ·  🕒 ${_formatNoticeDate(n.createdAt)}`;
  if (n.updatedAt && n.updatedAt !== n.createdAt) {
    metaText += `  ·  ✏️ ${_formatNoticeDate(n.updatedAt)} 수정됨`;
  }
  document.getElementById('ndMeta').textContent = metaText;
  document.getElementById('ndContent').textContent = n.content || '';

  const commentList = document.getElementById('ndCommentList');
  const comments = n.comments || [];
  document.getElementById('ndCommentCount').textContent = comments.length ? `(${comments.length})` : '';
  if (!comments.length) {
    commentList.innerHTML = '<p class="empty-msg" style="font-size:12px;">아직 댓글이 없습니다.</p>';
  } else {
    commentList.innerHTML = '';
    comments.forEach((c, idx) => {
      const item = document.createElement('div');
      item.className = 'comment-item';
      const canDelete = (S.isAdmin) || (S.currentUser && c.author === S.currentUser);
      item.innerHTML = `
        <div class="comment-head">
          <span class="comment-author">${_escapeHtml(c.author || '-')}</span>
          <span>${_formatNoticeDate(c.createdAt)}</span>
          <div class="comment-actions">
            ${canDelete ? `<button onclick="deleteComment(${idx})">삭제</button>` : ''}
          </div>
        </div>
        <div class="comment-body">${_escapeHtml(c.text || '')}</div>
      `;
      commentList.appendChild(item);
    });
  }

  const editBtn = document.getElementById('ndEditBtn');
  const delBtn  = document.getElementById('ndDeleteBtn');
  if (S.isAdmin) {
    editBtn.style.display = '';
    delBtn.style.display = '';
  } else {
    editBtn.style.display = 'none';
    delBtn.style.display = 'none';
  }

  const formWrap = document.getElementById('ndCommentFormWrap');
  if (S.isAdmin || S.currentUser) {
    formWrap.style.display = '';
    document.getElementById('ndCommentInput').value = '';
  } else {
    formWrap.style.display = 'none';
  }
}

function editCurrentNotice() {
  if (!S.currentNoticeId) return;
  openNoticeFormForEdit(S.currentNoticeId);
}

async function deleteCurrentNotice() {
  if (!S.currentNoticeId) return;
  const n = S.notices.find(x => x._id === S.currentNoticeId);
  if (!n) return;
  if (!confirm(`'${n.title}' 공지를 삭제하시겠습니까?`)) return;
  showLoading('삭제 중...');
  try {
    await window.DB.deleteNotice(S.currentNoticeId);
    // 낙관적 UI 갱신
    S.notices = S.notices.filter(x => x._id !== S.currentNoticeId);
    S.currentNoticeId = null;
    hideLoading();
    closeModal('noticeDetailModal');
    toast('삭제되었습니다', 'success');
    onDataChanged('notices');
  } catch(e) {
    hideLoading();
    toast('삭제 실패: ' + e.message, 'error');
  }
}

async function submitComment() {
  if (!S.currentNoticeId) return;
  const input = document.getElementById('ndCommentInput');
  const text = input.value.trim();
  if (!text) { input.focus(); return; }

  const n = S.notices.find(x => x._id === S.currentNoticeId);
  if (!n) { toast('공지를 찾을 수 없습니다', 'error'); return; }

  const author = S.isAdmin ? (S.currentAdminName + ' (관리자)') : (S.currentUser || '익명');
  const newComment = { author, text, createdAt: new Date().toISOString() };

  const updatedComments = [...(n.comments || []), newComment];
  const data = { ...n, comments: updatedComments };
  delete data._id;

  try {
    await window.DB.updateNotice(S.currentNoticeId, data);
    input.value = '';
    // 낙관적 UI 갱신
    const idx = S.notices.findIndex(x => x._id === S.currentNoticeId);
    if (idx >= 0) {
      S.notices[idx] = { _id: S.currentNoticeId, ...data };
      // 열려 있는 모달도 즉시 갱신
      renderNoticeDetail(S.notices[idx]);
    }
    onDataChanged('notices');
  } catch(e) {
    toast('댓글 등록 실패: ' + e.message, 'error');
  }
}

async function deleteComment(idx) {
  if (!S.currentNoticeId) return;
  if (!confirm('댓글을 삭제하시겠습니까?')) return;
  const n = S.notices.find(x => x._id === S.currentNoticeId);
  if (!n) return;
  const comments = [...(n.comments || [])];
  comments.splice(idx, 1);
  const data = { ...n, comments };
  delete data._id;
  try {
    await window.DB.updateNotice(S.currentNoticeId, data);
    // 낙관적 UI 갱신
    const idx = S.notices.findIndex(x => x._id === S.currentNoticeId);
    if (idx >= 0) {
      S.notices[idx] = { _id: S.currentNoticeId, ...data };
      renderNoticeDetail(S.notices[idx]);
    }
    onDataChanged('notices');
  } catch(e) {
    toast('삭제 실패: ' + e.message, 'error');
  }
}

function _escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ══════════════════════════════════════════════════════════════════
// 로그인 화면: 새 소식 알림 (공지 + 강의/연수)
// "참여(댓글/신청)하지 않은 항목"만 새 항목으로 표시
// localStorage의 마지막 로그인 이름을 기준으로 판정
// 공지는 등록 후 LOGIN_NOTICE_MAX_DAYS 일이 지나면 자동 제외
// ══════════════════════════════════════════════════════════════════

const LOGIN_NOTICE_MAX_DAYS = 30;   // 이 값을 바꾸면 만료 기간 조정됨

function _todayStrLocal() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function _getLoginUnreadItems() {
  const myName = (() => { try { return localStorage.getItem('tff_last_user') || ''; } catch(e) { return ''; } })();
  const todayStr = _todayStrLocal();

  // 공지 만료 기준 (LOGIN_NOTICE_MAX_DAYS일 이전 등록은 제외)
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOGIN_NOTICE_MAX_DAYS);
  const cutoffIso = cutoff.toISOString();

  // 1) 공지: 30일 이내 + 내가 댓글 안 단 것만. 이름 없으면 30일 이내 전체.
  const notices = Array.isArray(S.notices) ? [...S.notices] : [];
  const unreadNotices = notices.filter(n => {
    // 등록 후 30일 지난 공지는 자동 제외 (createdAt 없는 레거시 데이터는 표시 유지)
    if (n.createdAt && n.createdAt < cutoffIso) return false;
    if (!myName) return true;
    const comments = Array.isArray(n.comments) ? n.comments : [];
    return !comments.some(c => c.author === myName);
  }).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  // 2) 일정: 내가 신청하지 않은 미래 일정만. 이름이 없으면 전체(미래만).
  const events = Array.isArray(S.events) ? [...S.events] : [];
  let myApps = {};
  if (myName && S.instructors[myName] && S.instructors[myName].applications) {
    myApps = S.instructors[myName].applications;
  }
  const unreadEvents = events.filter(ev => {
    if (!ev.date || ev.date < todayStr) return false;  // 지난 일정 제외
    if (ev.status === 'closed') return false;          // 마감 일정 제외
    if (!myName) return true;
    return !myApps[ev._id];
  }).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  return { unreadNotices, unreadEvents, hasUser: !!myName };
}

function renderLoginNotices() {
  const wrap = document.getElementById('loginNoticesWrap');
  if (!wrap) return;

  const loginActive = document.getElementById('loginScreen').classList.contains('active');
  if (!loginActive) { wrap.style.display = 'none'; return; }

  const { unreadNotices, unreadEvents, hasUser } = _getLoginUnreadItems();
  const nCount = unreadNotices.length;
  const eCount = unreadEvents.length;

  if (nCount === 0 && eCount === 0) { wrap.style.display = 'none'; return; }

  wrap.style.display = '';

  // 헤더 텍스트 — 사용자 식별 여부에 따라 친근하게
  const headerEl = document.getElementById('loginNoticesHeaderText');
  if (headerEl) headerEl.textContent = hasUser ? '확인이 필요한 소식' : '등록된 새 소식';

  // 본문 — 카테고리별 1행씩 (건수 + 행동 안내)
  const rows = [];
  if (nCount > 0) {
    rows.push(`
      <div class="login-notice-row">
        <div class="ln-icon">📌</div>
        <div class="ln-text">
          <div class="ln-cat">공지사항 <span class="ln-count">${nCount}건</span></div>
          <div class="ln-action">💬 로그인 후 댓글로 확인 부탁드려요</div>
        </div>
      </div>`);
  }
  if (eCount > 0) {
    rows.push(`
      <div class="login-notice-row">
        <div class="ln-icon">📅</div>
        <div class="ln-text">
          <div class="ln-cat">강의/연수 <span class="ln-count">${eCount}건</span></div>
          <div class="ln-action">✋ 로그인 후 참여 신청해 주세요</div>
        </div>
      </div>`);
  }

  document.getElementById('loginNoticesBody').innerHTML = rows.join('');
}

function exportExcel() {
  const pfx = `${S.calYear}-${String(S.calMonth+1).padStart(2,'0')}`;
  const evs = S.events.filter(e => e.date.startsWith(pfx));
  if (!evs.length) { alert('이번 달 일정이 없습니다.'); return; }
  evs.sort((a,b) => (a.date+'T'+(a.startTime||'00:00')).localeCompare(b.date+'T'+(b.startTime||'00:00')));
  const rows = [['유형','제목','날짜','시작시간','종료시간','장소','내용','신청자수','승인자수','거절자수']];
  evs.forEach(ev => {
    const apps = Object.values(S.instructors).filter(u => u.applications && u.applications[ev._id]);
    const approved = apps.filter(u => u.applications[ev._id] === 'approved').length;
    const rejected = apps.filter(u => u.applications[ev._id] === 'rejected').length;
    rows.push([ev.type, ev.title, ev.date, ev.startTime||'', ev.endTime||'', ev.place, ev.desc||'', apps.length, approved, rejected]);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '일정');
  XLSX.writeFile(wb, `티치포퓨처_일정_${S.calYear}년${MON[S.calMonth]}.xlsx`);
}

function exportInstExcel() {
  const approvedNames = Object.keys(S.instructors).filter(n => (S.instructors[n].status || 'approved') === 'approved');
  if (!approvedNames.length) { alert('승인된 강사가 없습니다.'); return; }
  const dayHeaders = DAYS.flatMap(d => [`${d.label}오전`, `${d.label}오후`]);
  const rows = [['이름','이메일','연락처','주소','차량유무','최종학력','관련전공여부','학력1','학력2','학력3','경력1','경력2','경력3','경력4','경력5','자격증1','자격증2','자격증3','자격증4','자격증5','전공/과목',...dayHeaders,'어필','총 신청수']];
  approvedNames.forEach(name => {
    const u = getProfile(S.instructors[name]);
    const apps = Object.entries(u.applications || {});
    const total = apps.filter(([,st]) => st).length;
    const dayVals = DAYS.flatMap(d => [
      u.days[d.key+'_am'] ? 'O' : '',
      u.days[d.key+'_pm'] ? 'O' : ''
    ]);
    rows.push([
      name, u.email||'', u.phone||'', u.addr||'', u.carOwn||'',
      u.eduLevel||'', u.isMajor === true ? '전공' : u.isMajor === false ? '비전공' : '',
      ...(u.edu || ['','','']),
      ...(u.career || ['','','','','']),
      ...(u.certs || ['','','','','']),
      u.subject||'',
      ...dayVals,
      u.appeal||'',
      total
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '강사목록');
  XLSX.writeFile(wb, `티치포퓨처_강사목록_${new Date().toISOString().slice(0,10)}.xlsx`);
}

const LAST_BACKUP_KEY = 'tff_ims_last_backup';
const BACKUP_VERSION = '1.0';

function _fmtDateTime(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function _fmtFileStamp(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function refreshLastBackupTime() {
  const els = [document.getElementById('lastBackupTime2')].filter(Boolean);
  if (!els.length) return;
  const t = localStorage.getItem(LAST_BACKUP_KEY);
  if (!t) {
    els.forEach(el => { el.textContent = '아직 백업하지 않음'; el.style.color = 'var(--red)'; });
    return;
  }
  const dt = new Date(t);
  const days = Math.floor((Date.now() - dt.getTime()) / (1000*60*60*24));
  let warning = '';
  let color = 'var(--green)';
  if (days >= 7) { warning = ` (${days}일 경과 — 백업을 권장합니다)`; color = 'var(--amber)'; }
  els.forEach(el => { el.textContent = _fmtDateTime(dt) + warning; el.style.color = color; });
}

function downloadBackupJson() {
  try {
    const backup = {
      _meta: {
        app: '티치포퓨처 강사/연수 관리',
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        exportedBy: S.currentAdminName || 'unknown',
        includesPasswordHashes: true,
        counts: {
          instructors: Object.keys(S.instructors).length,
          events: S.events.length,
          admins: Object.keys(S.admins).length,
          notices: S.notices.length
        }
      },
      instructors: S.instructors,
      events: S.events.map(ev => ({ ...ev })),
      admins: S.admins,
      notices: S.notices.map(n => ({ ...n }))
    };

    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const stamp = _fmtFileStamp(new Date());
    const a = document.createElement('a');
    a.href = url;
    a.download = `티치포퓨처_백업_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
    refreshLastBackupTime();
    toast('백업 완료', 'success');
  } catch(e) {
    toast('백업 실패: ' + e.message, 'error');
  }
}

function downloadBackupExcel() {
  try {
    const wb = XLSX.utils.book_new();
    const dayHeaders = DAYS.flatMap(d => [`${d.label}오전`, `${d.label}오후`]);
    const instRows = [['이름','상태','이메일','연락처','주소','차량유무','전공/과목','최종학력','관련전공여부','학력1','학력2','학력3','경력1','경력2','경력3','경력4','경력5','자격증1','자격증2','자격증3','자격증4','자격증5',...dayHeaders,'어필']];
    Object.entries(S.instructors).sort().forEach(([name, rawU]) => {
      const u = getProfile(rawU);
      const dayVals = DAYS.flatMap(d => [u.days[d.key+'_am'] ? 'O' : '', u.days[d.key+'_pm'] ? 'O' : '']);
      const statusKr = u.status === 'approved' ? '승인됨' : u.status === 'pending' ? '대기중' : '거절됨';
      instRows.push([name, statusKr, u.email||'', u.phone||'', u.addr||'', u.carOwn||'', u.subject||'', u.eduLevel||'', u.isMajor === true ? '전공' : u.isMajor === false ? '비전공' : '', ...(u.edu||['','','']), ...(u.career||['','','','','']), ...(u.certs||['','','','','']), ...dayVals, u.appeal||'']);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(instRows), '강사목록');

    const evRows = [['유형','제목','날짜','시작시간','종료시간','장소','내용','신청자수','승인자수']];
    [...S.events].sort((a,b) => a.date.localeCompare(b.date)).forEach(ev => {
      const apps = Object.values(S.instructors).filter(u => u.applications && u.applications[ev._id]);
      const approved = apps.filter(u => u.applications[ev._id] === 'approved').length;
      evRows.push([ev.type, ev.title, ev.date, ev.startTime||'', ev.endTime||'', ev.place||'', ev.desc||'', apps.length, approved]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(evRows), '전체일정');

    const stamp = _fmtFileStamp(new Date());
    XLSX.writeFile(wb, `티치포퓨처_보고서_${stamp}.xlsx`);
    toast('엑셀 보고서 생성 완료', 'success');
  } catch(e) {
    toast('보고서 생성 실패: ' + e.message, 'error');
  }
}

let _pendingRestoreData = null;

function handleRestoreFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  const el2 = document.getElementById('restoreFileName2');
  if (el2) el2.textContent = file.name;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data._meta || !data.instructors || !data.events || !data.admins) {
        toast('백업 파일 형식이 올바르지 않습니다', 'error'); return;
      }
      if (!data.notices) data.notices = [];
      _pendingRestoreData = data;
      const m = data._meta;
      document.getElementById('restorePreview').innerHTML = `
        <div style="background:var(--bg);padding:12px 14px;border-radius:var(--radius-sm);margin-bottom:10px;">
          <div><b>생성 시각:</b> ${m.exportedAt ? new Date(m.exportedAt).toLocaleString('ko-KR') : '-'}</div>
          <div><b>생성자:</b> ${m.exportedBy || '-'}</div>
        </div>
        <div style="background:var(--bg);padding:12px 14px;border-radius:var(--radius-sm);">
          <div>강사: <b>${Object.keys(data.instructors).length}명</b></div>
          <div>일정: <b>${data.events.length}건</b></div>
          <div>공지사항: <b>${(data.notices||[]).length}건</b></div>
        </div>
      `;
      openModal('restoreModal');
    } catch(err) {
      toast('파일 읽기 실패: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

function cancelRestore() {
  _pendingRestoreData = null;
  const el2 = document.getElementById('restoreFile2'); if (el2) el2.value = '';
  const fn2 = document.getElementById('restoreFileName2'); if (fn2) fn2.textContent = '';
  closeModal('restoreModal');
}

async function executeRestore() {
  if (!_pendingRestoreData) return;
  closeModal('restoreModal');
  showLoading('복원 진행 중...');
  try {
    const data = _pendingRestoreData;
    for (const name of Object.keys(S.instructors)) await window.DB.deleteInstructor(name);
    for (const ev of S.events) await window.DB.deleteEvent(ev._id);
    for (const n of S.notices) await window.DB.deleteNotice(n._id);
    for (const name of Object.keys(S.admins)) { if (name !== S.currentAdminName) await window.DB.deleteAdmin(name); }
    for (const [name, profile] of Object.entries(data.instructors)) await window.DB.saveInstructor(name, profile);
    for (const ev of data.events) { const { _id, ...evData } = ev; if (_id) await window.DB.updateEvent(_id, evData); else await window.DB.addEvent(evData); }
    for (const n of (data.notices||[])) { const { _id, ...nData } = n; if (_id) await window.DB.updateNotice(_id, nData); else await window.DB.addNotice(nData); }
    for (const [name, hashedPw] of Object.entries(data.admins)) await window.DB.setAdmin(name, hashedPw);
    _pendingRestoreData = null;
    hideLoading();
    toast('복원 완료', 'success');
    setTimeout(() => { if (confirm('복원이 완료되었습니다. 새로고침할까요?')) location.reload(); }, 1500);
  } catch(e) {
    hideLoading();
    toast('복원 실패: ' + e.message, 'error');
  }
}

function toggleManual() {
  const content = document.getElementById('manualContent');
  const btn = document.getElementById('manualToggleBtn');
  if (!content) return;
  const isHidden = content.style.display === 'none';
  if (isHidden) {
    renderManual();
    content.style.display = '';
    btn.textContent = '접기';
  } else {
    content.style.display = 'none';
    btn.textContent = '펼쳐 보기';
  }
}

function renderManualIfShown() {
  const content = document.getElementById('manualContent');
  if (content && content.style.display !== 'none') renderManual();
}

function renderManual() {
  const el = document.getElementById('manualContent');
  if (!el) return;
  el.innerHTML = `
    <style>
      .manual-section { margin-bottom: 20px; }
      .manual-section h4 { font-size: 14px; color: var(--blue); margin: 14px 0 8px; padding-bottom: 4px; border-bottom: 2px solid var(--blue-light); }
      .manual-section p, .manual-section li { font-size: 12px; line-height: 1.8; }
      .manual-section ul, .manual-section ol { margin-left: 20px; margin-bottom: 8px; }
      .manual-section .note { background: var(--blue-light); color: var(--blue-dark); padding: 8px 12px; border-radius: var(--radius-sm); font-size: 12px; margin: 8px 0; line-height: 1.7; }
    </style>
    <div class="manual-section">
      <h4>🔐 보안 구조</h4>
      <p>이 앱은 두 겹의 보안으로 Firestore를 보호합니다:</p>
      <ol>
        <li><b>앱 내부 비밀번호 검증</b> — SHA-256 해시로 이름+비밀번호 확인</li>
        <li><b>Firebase Auth 토큰</b> — 검증 성공 후 익명 로그인으로 Firestore 접근 권한 획득</li>
      </ol>
      <div class="note">Firebase 콘솔 Firestore 보안 규칙을 <code>if request.auth != null;</code> 으로 변경하면 토큰 없이는 아무도 DB에 직접 접근할 수 없습니다.</div>
    </div>
    <div class="manual-section">
      <h4>강사 가입 승인</h4>
      <ol>
        <li>신규 강사 → 이름+비밀번호 입력 → 가입 신청 접수 (pending)</li>
        <li>관리자 화면 "✅ 강사 승인" 탭에 빨간 배지로 대기 건수 표시</li>
        <li>관리자가 승인/거절 처리</li>
        <li>승인된 강사만 다음 로그인부터 정상 입장 가능</li>
      </ol>
    </div>
    <div class="manual-section">
      <h4>관리자 비밀번호 분실 시</h4>
      <p>Firebase 콘솔 → Firestore → admins 컬렉션 → admin 문서 삭제 → 페이지 새로고침 → admin/admin1234로 재생성</p>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:24px 0 14px;">
    <div style="text-align:center;font-size:11px;color:var(--text-hint);">
      AI코딩연구소 제작 · Kim Byeong-Du, Hong Sang-Jin
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════
// 강사 등급 시스템 (계산 및 UI 렌더링)
// ══════════════════════════════════════════════════════════════════

async function renderGradeTab() {
  const tbody = document.getElementById('gradingTableBody');
  if (!tbody) return;

  // 1. 가중치 설정 불러오기 (없는 키는 기본값으로 보정)
  const cfgRaw = await window.DB.getGradingConfig();
  const config = {
    wHigh: cfgRaw.wHigh ?? 0,
    wCollege: cfgRaw.wCollege ?? 5,
    wUni: cfgRaw.wUni ?? 10,
    wGrad: cfgRaw.wGrad ?? 20,
    wCar: cfgRaw.wCar ?? 5,
    wMajor: cfgRaw.wMajor ?? 15,
    wClass: cfgRaw.wClass ?? 2,
    wCertTeacher: cfgRaw.wCertTeacher ?? 15,
    wCertLifelong: cfgRaw.wCertLifelong ?? 12,
    wCertYouth: cfgRaw.wCertYouth ?? 8,
    wCertNational: cfgRaw.wCertNational ?? 5,
    wCertOther: cfgRaw.wCertOther ?? 2
  };
  document.getElementById('wHigh').value = config.wHigh;
  document.getElementById('wCollege').value = config.wCollege;
  document.getElementById('wUni').value = config.wUni;
  document.getElementById('wGrad').value = config.wGrad;
  document.getElementById('wCar').value = config.wCar;
  document.getElementById('wMajor').value = config.wMajor;
  document.getElementById('wClass').value = config.wClass;
  document.getElementById('wCertTeacher').value = config.wCertTeacher;
  document.getElementById('wCertLifelong').value = config.wCertLifelong;
  document.getElementById('wCertYouth').value = config.wCertYouth;
  document.getElementById('wCertNational').value = config.wCertNational;
  document.getElementById('wCertOther').value = config.wCertOther;

  // 기타 자격증 — 운전면허·민간자격증·기타자격증만 (국가기술/기능사는 별도 항목으로 분리)
  const OTHER_CERTS = ['운전면허','민간자격증','기타자격증'];

  // 2. 승인된 강사 목록 가져오기 및 점수 계산
  let list = [];
  Object.keys(S.instructors).forEach(name => {
    const u = getProfile(S.instructors[name]);
    if (u.status !== 'approved') return;

    // 참여 횟수 계산 ('approved' 된 수업만 카운트)
    const classCount = Object.values(u.applications || {}).filter(st => st === 'approved').length;

    // 자동 점수 항목별 breakdown — { label, reason, score }
    const breakdown = [];

    // 학력
    if (u.eduLevel) {
      let s = 0;
      if (u.eduLevel === '고졸') s = Number(config.wHigh);
      else if (u.eduLevel === '전문대졸') s = Number(config.wCollege);
      else if (u.eduLevel === '대졸') s = Number(config.wUni);
      else if (u.eduLevel === '대학원졸') s = Number(config.wGrad);
      breakdown.push({ label: '학력', reason: u.eduLevel, score: s });
    }

    // 관련 전공
    if (u.isMajor === true || u.isMajor === false) {
      const s = u.isMajor === true ? Number(config.wMajor) : 0;
      breakdown.push({ label: '관련 전공', reason: u.isMajor === true ? '전공자' : '비전공자', score: s });
    }

    // 차량
    if (u.carOwn) {
      const s = u.carOwn === '있음' ? Number(config.wCar) : 0;
      breakdown.push({ label: '차량보유', reason: u.carOwn, score: s });
    }

    // 수업 참여 (항상 표시)
    breakdown.push({
      label: '수업 참여',
      reason: `${classCount}회 × ${config.wClass}`,
      score: classCount * Number(config.wClass)
    });

    // 자격증
    const cats = Array.isArray(u.certCategories) ? u.certCategories : [];
    if (cats.includes('교원자격')) {
      breakdown.push({ label: '교원자격', reason: '보유', score: Number(config.wCertTeacher) });
    }
    if (cats.includes('평생교육사')) {
      breakdown.push({ label: '평생교육사', reason: '보유', score: Number(config.wCertLifelong) });
    }
    if (cats.includes('청소년지도사')) {
      breakdown.push({ label: '청소년지도사', reason: '보유', score: Number(config.wCertYouth) });
    }
    // 국가기술자격(기사,기능사) — 신항목 + 구항목('국가기술자격증','국가기능사자격증') 호환
    const hasNational = cats.includes('국가기술자격(기사,기능사)')
                     || cats.includes('국가기술자격증')
                     || cats.includes('국가기능사자격증');
    if (hasNational) {
      breakdown.push({ label: '국가기술자격', reason: '기사·기능사', score: Number(config.wCertNational) });
    }
    const otherCount = cats.filter(c => OTHER_CERTS.includes(c)).length;
    if (otherCount > 0) {
      breakdown.push({
        label: '기타 자격증',
        reason: `${otherCount}개 × ${config.wCertOther}`,
        score: otherCount * Number(config.wCertOther)
      });
    }

    // 자동 합계 = breakdown 합
    const sysScore = breakdown.reduce((sum, b) => sum + Number(b.score || 0), 0);

    const total = sysScore + (Number(u.manualScore) || 0);

    list.push({
      name: name,
      breakdown: breakdown,
      sysScore: sysScore,
      manualScore: u.manualScore || 0,
      total: total
    });
  });

  // 3. 총점(Total) 기준 내림차순 정렬
  list.sort((a, b) => b.total - a.total);

  // 4. 테이블 그리기
  tbody.innerHTML = '';
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-msg" style="text-align:center; padding:20px;">평가할 강사가 없습니다.</td></tr>';
    return;
  }

  list.forEach((item, idx) => {
    // 1~3등은 순위 뱃지 스타일링
    const rankBadge = idx < 3 ? `<span class="badge" style="background:var(--amber);color:white;">${idx + 1}위</span>` : `${idx + 1}위`;

    // breakdown 행 HTML
    const bdRows = item.breakdown.map(b => `
      <div class="bd-row">
        <span class="bd-label">${b.label}</span>
        <span class="bd-reason">${_escapeHtml(b.reason)}</span>
        <span class="bd-score ${b.score > 0 ? 'pos' : 'zero'}">${b.score >= 0 ? '+' : ''}${b.score}</span>
      </div>`).join('');

    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border)';
    tr.innerHTML = `
      <td style="padding:10px; vertical-align:top;">${rankBadge}</td>
      <td style="padding:10px; font-weight:500; vertical-align:top;">${item.name}</td>
      <td style="padding:10px; vertical-align:top;">
        <div class="bd-table">
          ${bdRows}
          <div class="bd-sum-row">
            <span>자동 합계</span>
            <span class="bd-sum-val">${item.sysScore}점</span>
          </div>
        </div>
      </td>
      <td style="padding:10px; vertical-align:top;">
        <input type="number" id="manual_${item.name}" value="${item.manualScore}" style="width:60px; padding:4px; border:1px solid var(--border); border-radius:4px;"> 점
      </td>
      <td style="padding:10px; font-weight:700; color:var(--blue); font-size:16px; vertical-align:top;">${item.total}</td>
      <td style="padding:10px; vertical-align:top;">
        <button class="btn sm" onclick="saveManualScore('${item.name.replace(/'/g, "\\'")}')">수정 반영</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// 가중치 저장 기능
async function saveGradingWeights() {
  const config = {
    wHigh: Number(document.getElementById('wHigh').value) || 0,
    wCollege: Number(document.getElementById('wCollege').value) || 0,
    wUni: Number(document.getElementById('wUni').value) || 0,
    wGrad: Number(document.getElementById('wGrad').value) || 0,
    wCar: Number(document.getElementById('wCar').value) || 0,
    wMajor: Number(document.getElementById('wMajor').value) || 0,
    wClass: Number(document.getElementById('wClass').value) || 0,
    wCertTeacher: Number(document.getElementById('wCertTeacher').value) || 0,
    wCertLifelong: Number(document.getElementById('wCertLifelong').value) || 0,
    wCertYouth: Number(document.getElementById('wCertYouth').value) || 0,
    wCertNational: Number(document.getElementById('wCertNational').value) || 0,
    wCertOther: Number(document.getElementById('wCertOther').value) || 0
  };
  
  showLoading('가중치 저장 중...');
  try {
    await window.DB.saveGradingConfig(config);
    hideLoading();
    toast('가중치가 저장되고 점수가 재계산되었습니다.', 'success');
    renderGradeTab();
  } catch(e) {
    hideLoading();
    toast('저장 실패: ' + e.message, 'error');
  }
}

// 개별 강사 정성 평가 점수 저장 기능
async function saveManualScore(name) {
  const inputEl = document.getElementById(`manual_${name}`);
  if (!inputEl) return;
  const newScore = Number(inputEl.value) || 0;

  try {
    await window.DB.updateInstructor(name, { manualScore: newScore });
    // 로컬 데이터 즉시 업데이트
    if (S.instructors[name]) S.instructors[name].manualScore = newScore;
    toast(`${name} 강사의 평가 점수가 반영되었습니다.`, 'success');
    renderGradeTab();
  } catch(e) {
    toast('점수 반영 실패: ' + e.message, 'error');
  }
}

// Global 함수 매핑
window.loginInst = loginInst;
window.openAdminLoginModal = openAdminLoginModal;
window.loginAdmin = loginAdmin;
window.closeAdminLoginModal = closeAdminLoginModal;
window.logout = logout;
window.showIP = showIP;
window.showAP = showAP;
window.saveProfile = saveProfile;
window.changeInstPw = changeInstPw;
window.applyEv = applyEv;
window.cancelApp = cancelApp;
window.setInstEventFilter = setInstEventFilter;
window.setInstListSort = setInstListSort;
window.toggleCertCategories = toggleCertCategories;
window._updateCertCatLabel = _updateCertCatLabel;
window.openSignupModal = openSignupModal;
window.submitSignup = submitSignup;
window.submitSignupWithIdentifier = submitSignupWithIdentifier;
window.approveInstructor = approveInstructor;
window.rejectInstructor = rejectInstructor;
window.chMon = chMon;
window.renderAdminSchedule = renderAdminSchedule;
window.openAddEventForCreate = openAddEventForCreate;
window.saveEvent = saveEvent;
window.closeAddEvModal = closeAddEvModal;
window.openEvDetail = openEvDetail;
window.approveApp = approveApp;
window.deleteEvent = deleteEvent;
window.openProfile = openProfile;
window.deleteInst = deleteInst;
window.resetInstPassword = resetInstPassword;
window.addAdmin = addAdmin;
window.deleteAdmin = deleteAdmin;
window.changePw = changePw;
window.openNoticeForm = openNoticeForm;
window.closeNoticeForm = closeNoticeForm;
window.saveNotice = saveNotice;
window.openNoticeDetail = openNoticeDetail;
window.editCurrentNotice = editCurrentNotice;
window.deleteCurrentNotice = deleteCurrentNotice;
window.submitComment = submitComment;
window.deleteComment = deleteComment;
window.exportExcel = exportExcel;
window.exportInstExcel = exportInstExcel;
window.downloadBackupJson = downloadBackupJson;
window.downloadBackupExcel = downloadBackupExcel;
window.handleRestoreFileSelect = handleRestoreFileSelect;
window.cancelRestore = cancelRestore;
window.executeRestore = executeRestore;
window.toggleManual = toggleManual;
window.searchInst = searchInst;
window.resetInstSearch = resetInstSearch;
window.openModal = openModal;
window.closeModal = closeModal;
window.renderGradeTab = renderGradeTab;
window.saveGradingWeights = saveGradingWeights;
window.saveManualScore = saveManualScore;

// ══════════════════════════════════════════════════════════════════
// 🏢 사무실 방문 신청 시스템
// ══════════════════════════════════════════════════════════════════

// ─── 강사 캘린더 ────────────────────────────────────────────────
function chMonInst(d) {
  S.instCalMonth += d;
  if (S.instCalMonth > 11) { S.instCalMonth = 0; S.instCalYear++; }
  if (S.instCalMonth < 0)  { S.instCalMonth = 11; S.instCalYear--; }
  renderInstCal();
}

function renderInstCal() {
  const titleEl = document.getElementById('instCalTitle');
  const grid = document.getElementById('instCalGrid');
  if (!titleEl || !grid) return;

  titleEl.textContent = `${S.instCalYear}년 ${MON[S.instCalMonth]}`;
  grid.innerHTML = '';
  ['일','월','화','수','목','금','토'].forEach(d => {
    const h = document.createElement('div'); h.className = 'cal-day-hdr'; h.textContent = d; grid.appendChild(h);
  });

  const first = new Date(S.instCalYear, S.instCalMonth, 1).getDay();
  const days = new Date(S.instCalYear, S.instCalMonth + 1, 0).getDate();
  for (let i = 0; i < first; i++) {
    const empty = document.createElement('div'); empty.className = 'cal-day other-month'; grid.appendChild(empty);
  }
  const today = new Date();
  const myName = S.currentUser;

  for (let d = 1; d <= days; d++) {
    const cell = document.createElement('div'); cell.className = 'cal-day';
    if (d === today.getDate() && S.instCalMonth === today.getMonth() && S.instCalYear === today.getFullYear())
      cell.classList.add('today');
    cell.innerHTML = `<div class="day-num">${d}</div>`;
    const ds = `${S.instCalYear}-${String(S.instCalMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

    // 강의/연수 일정 (읽기 전용, 강사 전용 정보 모달)
    const dayEvs = S.events.filter(e => e.date === ds);
    dayEvs.slice(0, 2).forEach(ev => {
      const dot = document.createElement('span');
      dot.className = 'ev-dot ' + typeCls(ev.type);
      dot.textContent = `[${ev.type}] ${ev.title}`;
      dot.onclick = (e) => { e.stopPropagation(); openInstEvInfo(ev._id); };
      dot.style.cursor = 'pointer';
      cell.appendChild(dot);
    });
    if (dayEvs.length > 2) {
      const more = document.createElement('span');
      more.className = 'ev-dot type-etc';
      more.textContent = `+${dayEvs.length - 2}건 더`;
      more.onclick = (e) => { e.stopPropagation(); openInstEvInfo(dayEvs[2]._id); };
      more.style.cursor = 'pointer';
      cell.appendChild(more);
    }

    // 내 방문 신청만 표시 (취소된 것도 회색으로 이력 표시)
    const myVisits = (S.visits || []).filter(v => v.date === ds && v.instructor === myName);
    myVisits.forEach(v => {
      const vdot = document.createElement('span');
      vdot.className = 'visit-dot ' + (v.status || 'pending');
      const icon = v.status === 'approved' ? '🟢'
                 : v.status === 'rejected' ? '🔴'
                 : v.status === 'cancelled' ? '⚫'
                 : '🟠';
      vdot.textContent = `${icon} ${v.time || ''} 방문`;
      vdot.onclick = (e) => { e.stopPropagation(); openInstVisitDetail(v._id); };
      vdot.style.cursor = 'pointer';
      cell.appendChild(vdot);
    });

    // 날짜 클릭 → 모바일은 일목 표시, 데스크톱은 곧바로 신청 모달
    cell.onclick = () => {
      const isMobile = window.innerWidth <= 600;
      if (isMobile) {
        showInstMobileDay(ds, dayEvs, myVisits);
      } else {
        openVisitModal(ds);
      }
    };
    grid.appendChild(cell);
  }

  renderInstVisitList();
}

function showInstMobileDay(ds, dayEvs, myVisits) {
  const wrap = document.getElementById('instMobileDayEvents');
  const titleEl = document.getElementById('instMobileDayEventsTitle');
  const listEl = document.getElementById('instMobileDayEventsList');
  if (!wrap || !titleEl || !listEl) return;

  const dt = new Date(ds + 'T00:00:00');
  const dayLabel = ['일','월','화','수','목','금','토'][dt.getDay()];
  titleEl.textContent = `📅 ${ds} (${dayLabel})`;

  let html = '';
  if (dayEvs.length) {
    html += '<div style="font-size:11px;color:var(--text-sub);margin:6px 0;">강의/연수 일정</div>';
    dayEvs.forEach(ev => {
      html += `<div class="notice-card" onclick="openInstEvInfo('${ev._id}')" style="cursor:pointer;">
        <div class="notice-title-row">
          <span class="badge ${typeCls(ev.type)}" style="font-size:10px;">${ev.type}</span>
          <span class="notice-title">${_escapeHtml(ev.title)}</span>
        </div>
        <div class="notice-meta">${ev.startTime ? '🕒 ' + fmtTime(ev.startTime, ev.endTime) : ''} 📍 ${_escapeHtml(ev.place || '-')}</div>
      </div>`;
    });
  }
  if (myVisits.length) {
    html += '<div style="font-size:11px;color:var(--text-sub);margin:10px 0 6px;">내 방문 신청</div>';
    myVisits.forEach(v => {
      const icon = v.status === 'approved' ? '🟢'
                 : v.status === 'rejected' ? '🔴'
                 : v.status === 'cancelled' ? '⚫'
                 : '🟠';
      const label = v.status === 'approved' ? '승인'
                  : v.status === 'rejected' ? '거절'
                  : v.status === 'cancelled' ? '취소됨'
                  : '대기';
      html += `<div class="notice-card" onclick="openInstVisitDetail('${v._id}')" style="cursor:pointer;">
        <div class="notice-title-row"><span class="notice-title">${icon} ${v.time || ''} · ${label}</span></div>
        <div class="notice-meta">${_escapeHtml(v.purpose || '')}</div>
      </div>`;
    });
  }
  if (!dayEvs.length && !myVisits.length) {
    html += '<p class="empty-msg" style="margin-bottom:10px;">이 날짜에 일정이 없습니다.</p>';
  }
  html += `<button class="btn primary" style="width:100%;margin-top:10px;" onclick="openVisitModal('${ds}')">+ 이 날짜에 방문 신청</button>`;
  listEl.innerHTML = html;
  wrap.classList.add('show');
  setTimeout(() => wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
}

// ─── 강사: 내 방문 신청 목록 ─────────────────────────────────────
function renderInstVisitList() {
  const div = document.getElementById('instVisitList');
  if (!div) return;
  const myName = S.currentUser;
  const mine = (S.visits || [])
    .filter(v => v.instructor === myName)
    .sort((a, b) => (b.date + 'T' + (b.time || '00:00')).localeCompare(a.date + 'T' + (a.time || '00:00')));

  if (!mine.length) {
    div.innerHTML = '<p class="empty-msg">신청 내역이 없습니다. 캘린더에서 날짜를 선택해 신청해 보세요.</p>';
    return;
  }

  div.innerHTML = mine.map(v => _renderInstVisitCard(v)).join('');
}

// 강사 방문 신청 카드 HTML 생성 (캘린더 페이지와 방문신청 탭에서 공용)
function _renderInstVisitCard(v) {
  const icon = v.status === 'approved' ? '🟢'
             : v.status === 'rejected' ? '🔴'
             : v.status === 'cancelled' ? '⚫'
             : '🟠';
  const label = v.status === 'approved' ? '승인됨'
              : v.status === 'rejected' ? '거절됨'
              : v.status === 'cancelled' ? '취소됨'
              : '대기 중';
  const borderColor = v.status === 'approved' ? '#34A853'
                    : v.status === 'rejected' ? '#DC3545'
                    : v.status === 'cancelled' ? '#999'
                    : '#FF9800';
  // 취소 가능: 대기 또는 승인 (거절/취소는 불가)
  const canCancel = (v.status === 'pending' || v.status === 'approved');
  const opacity = (v.status === 'cancelled' || v.status === 'rejected') ? '0.7' : '1';

  return `
    <div class="notice-card" style="border-left-color:${borderColor};opacity:${opacity};">
      <div class="notice-title-row">
        <span class="notice-title">${icon} ${v.date} ${v.time || ''} — ${label}</span>
      </div>
      <div class="notice-meta">📝 ${_escapeHtml(v.purpose || '')}</div>
      ${v.reviewComment ? `<div class="notice-meta" style="color:var(--text);">💬 관리자: ${_escapeHtml(v.reviewComment)}</div>` : ''}
      ${v.cancelReason ? `<div class="notice-meta" style="color:#666;">❌ 취소 사유: ${_escapeHtml(v.cancelReason)}</div>` : ''}
      ${v.cancelledAt ? `<div class="notice-meta" style="font-size:11px;color:var(--text-hint);">취소 시각: ${(v.cancelledAt).slice(0,16).replace('T',' ')}</div>` : ''}
      ${canCancel ? `<div style="margin-top:8px;"><button class="btn sm" onclick="openCancelVisitModal('${v._id}')">방문 취소</button></div>` : ''}
    </div>`;
}

// ─── 강사: 방문 신청 모달 ────────────────────────────────────────
function _todayStrForVisit() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function openVisitModal(preDate) {
  if (!S.currentUser) { toast('로그인이 필요합니다.', 'error'); return; }
  document.getElementById('vrDate').value = preDate || _todayStrForVisit();
  document.getElementById('vrTime').value = '';
  document.getElementById('vrPurpose').value = '';
  openModal('visitRequestModal');
}

let _savingVisit = false;
async function saveVisitRequest() {
  if (_savingVisit) return;  // 더블 클릭 방지

  const date = document.getElementById('vrDate').value;
  const time = document.getElementById('vrTime').value.trim();
  const purpose = document.getElementById('vrPurpose').value.trim();

  if (!date) { toast('방문 일자를 선택하세요.', 'error'); return; }
  if (!time) { toast('방문 시간을 입력하세요.', 'error'); return; }
  if (!purpose) { toast('용무를 입력하세요.', 'error'); return; }
  if (date < _todayStrForVisit()) { toast('과거 날짜로는 신청할 수 없습니다.', 'error'); return; }

  // ─── 중복 방지: 동일 강사·날짜·시간이 이미 있으면 차단 (단, 취소·거절된 건은 제외) ───
  const dup = (S.visits || []).find(v =>
    v.instructor === S.currentUser &&
    v.date === date &&
    v.time === time &&
    (v.status === 'pending' || v.status === 'approved')
  );
  if (dup) {
    const lbl = dup.status === 'approved' ? '승인된' : '대기 중인';
    toast(`이미 ${date} ${time}에 ${lbl} 신청이 있습니다.`, 'error');
    return;
  }

  const data = {
    instructor: S.currentUser,
    date, time, purpose,
    status: 'pending',
    createdAt: new Date().toISOString(),
    reviewedBy: null,
    reviewedAt: null,
    reviewComment: ''
  };

  _savingVisit = true;
  // 신청 버튼 비활성화
  const submitBtn = document.querySelector('#visitRequestModal .btn.primary');
  if (submitBtn) submitBtn.disabled = true;

  showLoading('신청 중...');
  try {
    const newId = await window.DB.addVisit(data);
    // 낙관적 UI 갱신 (중복 _id 방지)
    if (!(S.visits || []).some(v => v._id === newId)) {
      S.visits = [...(S.visits || []), { _id: newId, ...data }];
    }
    hideLoading();
    closeModal('visitRequestModal');
    toast('✓ 방문 신청이 접수되었습니다. 관리자 승인 대기 중입니다.', 'success');
    renderInstCal();
  } catch (e) {
    hideLoading();
    toast('신청 실패: ' + e.message, 'error');
  } finally {
    _savingVisit = false;
    if (submitBtn) submitBtn.disabled = false;
  }
}

function openInstVisitDetail(visitId) {
  const v = (S.visits || []).find(x => x._id === visitId);
  if (!v) return;
  const label = v.status === 'approved' ? '✅ 승인됨'
              : v.status === 'rejected' ? '🚫 거절됨'
              : v.status === 'cancelled' ? '⚫ 취소됨'
              : '⏳ 대기 중';
  let msg = `📅 ${v.date}  🕒 ${v.time}\n📝 ${v.purpose}\n\n상태: ${label}`;
  if (v.reviewComment) msg += `\n관리자 메시지: ${v.reviewComment}`;
  if (v.cancelReason)  msg += `\n취소 사유: ${v.cancelReason}`;
  alert(msg);
}

// ─── 강사: 방문 취소 모달 ─────────────────────────────────────
function openCancelVisitModal(visitId) {
  const v = (S.visits || []).find(x => x._id === visitId);
  if (!v) return;
  if (v.status !== 'pending' && v.status !== 'approved') {
    toast('이미 처리된 신청은 취소할 수 없습니다.', 'error');
    return;
  }
  S.currentCancelVisitId = visitId;
  const statusLabel = v.status === 'approved' ? '✅ 승인됨' : '⏳ 대기 중';
  document.getElementById('vcInfo').innerHTML = `
    <b>${v.date} ${v.time || ''}</b> · ${_escapeHtml(v.purpose || '')}<br>
    <span style="font-size:12px;">현재 상태: ${statusLabel}</span>
  `;
  document.getElementById('vcReason').value = '';
  openModal('visitCancelModal');
}

async function confirmCancelVisit() {
  const id = S.currentCancelVisitId;
  if (!id) return;
  const v = (S.visits || []).find(x => x._id === id);
  if (!v) return;
  const reason = document.getElementById('vcReason').value.trim();

  showLoading('취소 처리 중...');
  try {
    const { _id, ...rest } = v;
    const updated = {
      ...rest,
      status: 'cancelled',
      cancelReason: reason,
      cancelledAt: new Date().toISOString()
    };
    await window.DB.updateVisit(id, updated);
    Object.assign(v, updated);  // 낙관적 UI
    hideLoading();
    closeModal('visitCancelModal');
    toast('방문 신청이 취소되었습니다.', 'success');
    // 두 곳 모두 갱신
    renderInstCal();
    const visitsTab = document.getElementById('ipVisits');
    if (visitsTab && visitsTab.classList.contains('active')) renderInstVisits();
  } catch (e) {
    hideLoading();
    toast('취소 실패: ' + e.message, 'error');
  }
}

// 호환성: 기존 cancelMyVisit 호출이 남아있을 경우를 위한 래퍼
function cancelMyVisit(visitId) {
  openCancelVisitModal(visitId);
}

// ─── 강사: 방문신청 탭 렌더 ─────────────────────────────────────
function renderInstVisits() {
  const div = document.getElementById('instVisitTabList');
  const bar = document.getElementById('instVisitFilterBar');
  if (!div || !bar) return;

  const myName = S.currentUser;
  const mine = (S.visits || []).filter(v => v.instructor === myName);

  const pendingCnt   = mine.filter(v => (v.status || 'pending') === 'pending').length;
  const approvedCnt  = mine.filter(v => v.status === 'approved').length;
  const rejectedCnt  = mine.filter(v => v.status === 'rejected').length;
  const cancelledCnt = mine.filter(v => v.status === 'cancelled').length;

  const filter = S.instVisitFilter || 'all';
  bar.innerHTML = `
    <button class="btn sm ${filter==='all'?'primary':''}" onclick="setInstVisitFilter('all')">전체 (${mine.length})</button>
    <button class="btn sm ${filter==='pending'?'primary':''}" onclick="setInstVisitFilter('pending')">⏳ 대기 (${pendingCnt})</button>
    <button class="btn sm ${filter==='approved'?'primary':''}" onclick="setInstVisitFilter('approved')">✅ 승인 (${approvedCnt})</button>
    <button class="btn sm ${filter==='rejected'?'primary':''}" onclick="setInstVisitFilter('rejected')">🚫 거절 (${rejectedCnt})</button>
    <button class="btn sm ${filter==='cancelled'?'primary':''}" onclick="setInstVisitFilter('cancelled')">⚫ 취소 (${cancelledCnt})</button>
  `;

  const filtered = filter === 'all' ? mine : mine.filter(v => (v.status || 'pending') === filter);
  // 최근 신청 우선 (날짜·시간 내림차순)
  filtered.sort((a, b) => (b.date + 'T' + (b.time || '00:00')).localeCompare(a.date + 'T' + (a.time || '00:00')));

  if (!filtered.length) {
    div.innerHTML = '<p class="empty-msg">해당하는 신청이 없습니다.</p>';
    return;
  }

  div.innerHTML = filtered.map(v => _renderInstVisitCard(v)).join('');
}

function setInstVisitFilter(mode) {
  S.instVisitFilter = mode;
  renderInstVisits();
}

// ─── 관리자: 방문 신청 관리 ─────────────────────────────────────
function renderAdminVisits() {
  const div = document.getElementById('adminVisitList');
  const bar = document.getElementById('visitFilterBar');
  if (!div || !bar) return;

  const visits = S.visits || [];
  const pendingCnt   = visits.filter(v => (v.status || 'pending') === 'pending').length;
  const approvedCnt  = visits.filter(v => v.status === 'approved').length;
  const rejectedCnt  = visits.filter(v => v.status === 'rejected').length;
  const cancelledCnt = visits.filter(v => v.status === 'cancelled').length;

  const filter = S.visitFilter || 'pending';
  bar.innerHTML = `
    <button class="btn sm ${filter==='pending'?'primary':''}" onclick="setVisitFilter('pending')">⏳ 대기 (${pendingCnt})</button>
    <button class="btn sm ${filter==='approved'?'primary':''}" onclick="setVisitFilter('approved')">✅ 승인 (${approvedCnt})</button>
    <button class="btn sm ${filter==='rejected'?'primary':''}" onclick="setVisitFilter('rejected')">🚫 거절 (${rejectedCnt})</button>
    <button class="btn sm ${filter==='cancelled'?'primary':''}" onclick="setVisitFilter('cancelled')">⚫ 취소 (${cancelledCnt})</button>
    <button class="btn sm ${filter==='all'?'primary':''}" onclick="setVisitFilter('all')">전체 (${visits.length})</button>
  `;

  const filtered = filter === 'all' ? [...visits] : visits.filter(v => (v.status || 'pending') === filter);
  filtered.sort((a, b) => {
    if (filter === 'pending') {
      // 대기 중은 빠른 날짜순 (처리 우선순)
      return (a.date + 'T' + (a.time || '00:00')).localeCompare(b.date + 'T' + (b.time || '00:00'));
    }
    // 나머지는 최근 등록순
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });

  if (!filtered.length) {
    div.innerHTML = '<p class="empty-msg">해당하는 신청이 없습니다.</p>';
    return;
  }

  div.innerHTML = filtered.map(v => {
    const icon = v.status === 'approved' ? '🟢'
               : v.status === 'rejected' ? '🔴'
               : v.status === 'cancelled' ? '⚫'
               : '🟠';
    const label = v.status === 'approved' ? '승인'
                : v.status === 'rejected' ? '거절'
                : v.status === 'cancelled' ? '취소됨(강사)'
                : '대기';
    const borderColor = v.status === 'approved' ? '#34A853'
                      : v.status === 'rejected' ? '#DC3545'
                      : v.status === 'cancelled' ? '#999'
                      : '#FF9800';
    const opacity = v.status === 'cancelled' ? '0.75' : '1';
    return `
      <div class="notice-card" style="border-left-color:${borderColor};cursor:pointer;opacity:${opacity};" onclick="openVisitReview('${v._id}')">
        <div class="notice-title-row">
          <span class="notice-title">${icon} ${v.date} ${v.time || ''} — ${_escapeHtml(v.instructor)} (${label})</span>
        </div>
        <div class="notice-meta">📝 ${_escapeHtml(v.purpose || '')}</div>
        ${v.reviewComment ? `<div class="notice-meta">💬 ${_escapeHtml(v.reviewComment)}</div>` : ''}
        ${v.cancelReason ? `<div class="notice-meta" style="color:#666;">❌ 취소 사유: ${_escapeHtml(v.cancelReason)}</div>` : ''}
      </div>`;
  }).join('');
}

function setVisitFilter(mode) {
  S.visitFilter = mode;
  renderAdminVisits();
}

function openVisitReview(visitId) {
  const v = (S.visits || []).find(x => x._id === visitId);
  if (!v) return;
  S.currentReviewVisitId = visitId;
  const label = v.status === 'approved' ? '✅ 승인됨'
              : v.status === 'rejected' ? '🚫 거절됨'
              : v.status === 'cancelled' ? '⚫ 강사가 취소함'
              : '⏳ 대기 중';
  document.getElementById('visitReviewBody').innerHTML = `
    <div><b>강사:</b> ${_escapeHtml(v.instructor)}</div>
    <div><b>일자:</b> ${v.date}</div>
    <div><b>시간:</b> ${v.time || '-'}</div>
    <div><b>용무:</b> ${_escapeHtml(v.purpose || '')}</div>
    <div style="margin-top:8px;"><b>현재 상태:</b> ${label}</div>
    ${v.reviewedBy ? `<div style="font-size:11px;color:var(--text-sub);margin-top:4px;">처리자: ${_escapeHtml(v.reviewedBy)} (${(v.reviewedAt || '').slice(0,16).replace('T',' ')})</div>` : ''}
    ${v.cancelReason ? `<div style="margin-top:8px;padding:8px 12px;background:#F5F5F5;border-radius:6px;font-size:12px;"><b>❌ 강사 취소 사유:</b> ${_escapeHtml(v.cancelReason)}</div>` : ''}
    ${v.cancelledAt && !v.cancelReason ? `<div style="margin-top:8px;font-size:11px;color:var(--text-sub);">취소 시각: ${v.cancelledAt.slice(0,16).replace('T',' ')} (사유 미입력)</div>` : ''}
  `;
  document.getElementById('vrReviewComment').value = v.reviewComment || '';

  // 취소된 건은 승인/거절 비활성화
  const isCancelled = v.status === 'cancelled';
  const modal = document.getElementById('visitReviewModal');
  const buttons = modal.querySelectorAll('.modal-footer .btn');
  buttons.forEach(btn => {
    const txt = btn.textContent.trim();
    if (txt === '승인' || txt === '거절') {
      btn.disabled = isCancelled;
      btn.style.opacity = isCancelled ? '0.4' : '1';
      btn.style.cursor = isCancelled ? 'not-allowed' : 'pointer';
    }
  });
  const commentTextarea = document.getElementById('vrReviewComment');
  if (commentTextarea) commentTextarea.disabled = isCancelled;

  openModal('visitReviewModal');
}

async function approveVisit() {
  const id = S.currentReviewVisitId;
  if (!id) return;
  const v = (S.visits || []).find(x => x._id === id);
  if (!v) return;
  if (v.status === 'cancelled') {
    toast('강사가 취소한 신청은 처리할 수 없습니다.', 'error');
    return;
  }
  const comment = document.getElementById('vrReviewComment').value.trim();
  showLoading('처리 중...');
  try {
    const { _id, ...rest } = v;
    const updated = {
      ...rest,
      status: 'approved',
      reviewedBy: S.currentAdminName || 'admin',
      reviewedAt: new Date().toISOString(),
      reviewComment: comment
    };
    await window.DB.updateVisit(id, updated);
    // ─── 낙관적 UI 갱신: onSnapshot 응답 대기 없이 즉시 반영 ───
    Object.assign(v, updated);
    hideLoading();
    closeModal('visitReviewModal');
    toast('✓ 승인되었습니다.', 'success');
    renderAdminVisits();
    updateVisitBadge();
    // 관리자 캘린더가 열려 있으면 점 색상도 즉시 갱신
    const calPage = document.getElementById('apCalendar');
    if (calPage && calPage.classList.contains('active')) renderCal();
  } catch (e) {
    hideLoading();
    toast('처리 실패: ' + e.message, 'error');
  }
}

async function rejectVisit() {
  const id = S.currentReviewVisitId;
  if (!id) return;
  const v = (S.visits || []).find(x => x._id === id);
  if (!v) return;
  if (v.status === 'cancelled') {
    toast('강사가 취소한 신청은 처리할 수 없습니다.', 'error');
    return;
  }
  if (!confirm('이 방문 신청을 거절하시겠습니까?')) return;
  const comment = document.getElementById('vrReviewComment').value.trim();
  showLoading('처리 중...');
  try {
    const { _id, ...rest } = v;
    const updated = {
      ...rest,
      status: 'rejected',
      reviewedBy: S.currentAdminName || 'admin',
      reviewedAt: new Date().toISOString(),
      reviewComment: comment
    };
    await window.DB.updateVisit(id, updated);
    // ─── 낙관적 UI 갱신 ───
    Object.assign(v, updated);
    hideLoading();
    closeModal('visitReviewModal');
    toast('거절 처리되었습니다.', 'success');
    renderAdminVisits();
    updateVisitBadge();
    const calPage = document.getElementById('apCalendar');
    if (calPage && calPage.classList.contains('active')) renderCal();
  } catch (e) {
    hideLoading();
    toast('처리 실패: ' + e.message, 'error');
  }
}

// ─── 관리자: 방문 배지 (대기 건수) ───────────────────────────────
function updateVisitBadge() {
  const badge = document.getElementById('visitBadge');
  if (!badge) return;
  const cnt = (S.visits || []).filter(v => (v.status || 'pending') === 'pending').length;
  if (cnt > 0) {
    badge.textContent = cnt;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

// ══════════════════════════════════════════════════════════════════
// 강사 캘린더 → 강의/연수 일정 클릭 시 강사 전용 정보 모달
// (다른 강사 신청 정보 일체 노출 X)
// ══════════════════════════════════════════════════════════════════
function openInstEvInfo(evId) {
  const ev = S.events.find(e => e._id === evId);
  if (!ev) return;

  document.getElementById('iemTitle').textContent = `[${ev.type}] ${ev.title}`;
  const timeStr = fmtTime(ev.startTime, ev.endTime);
  document.getElementById('iemInfo').textContent = `${ev.date}${timeStr ? ' · ' + timeStr : ''} · ${ev.place || '-'}`;
  document.getElementById('iemDesc').textContent = ev.desc || '';

  const u = S.instructors[S.currentUser];
  const myStatus = (u && u.applications) ? u.applications[evId] : null;
  const isClosed = ev.status === 'closed';
  const isPast = ev.date < _todayStrForVisit();

  let statusHtml = '';
  if (isClosed) {
    statusHtml = '🔒 <b>모집 마감된 일정입니다.</b>';
    if (myStatus === 'approved')      statusHtml += '<br>내 신청 상태: <span style="color:#1A6B36;font-weight:600;">✅ 승인됨</span>';
    else if (myStatus === 'pending')  statusHtml += '<br>내 신청 상태: <span style="color:#B85C00;">⏳ 미처리</span>';
    else if (myStatus === 'rejected') statusHtml += '<br>내 신청 상태: <span style="color:var(--text-sub);">✨ 다음 기회에</span>';
  } else if (isPast) {
    statusHtml = '📅 이미 종료된 일정입니다.';
    if (myStatus === 'approved') statusHtml += '<br>내 신청 상태: <span style="color:#1A6B36;font-weight:600;">✅ 승인됨</span>';
  } else if (myStatus === 'pending') {
    statusHtml = '⏳ <b>신청 중</b> — 관리자 검토를 기다리고 있습니다.';
  } else if (myStatus === 'approved') {
    statusHtml = '✅ <b style="color:#1A6B36;">승인되었습니다.</b>';
  } else if (myStatus === 'rejected') {
    statusHtml = '✨ 다음 기회에 — 이번에는 다른 강사가 배정되었습니다.';
  } else {
    statusHtml = '아직 신청하지 않았습니다.';
  }
  document.getElementById('iemStatus').innerHTML = statusHtml;

  // 액션 버튼
  let footerHtml = '';
  if (!isClosed && !isPast) {
    if (myStatus === 'pending' || myStatus === 'approved') {
      footerHtml += `<button class="btn danger" onclick="cancelAppFromCal('${evId}')">신청 취소</button>`;
    } else if (!myStatus) {
      footerHtml += `<button class="btn primary" onclick="applyEvFromCal('${evId}')">신청</button>`;
    }
  }
  footerHtml += `<button class="btn" onclick="closeModal('instEvInfoModal')">닫기</button>`;
  document.getElementById('iemFooter').innerHTML = footerHtml;

  openModal('instEvInfoModal');
}

async function applyEvFromCal(evId) {
  await applyEv(evId);
  closeModal('instEvInfoModal');
  renderInstCal();
  toast('신청되었습니다.', 'success');
}

async function cancelAppFromCal(evId) {
  const u = S.instructors[S.currentUser];
  const before = u && u.applications ? u.applications[evId] : null;
  await cancelApp(evId);  // 안에 confirm 있음
  const after = u && u.applications ? u.applications[evId] : null;
  // confirm 취소했으면 그대로 둠 (변동 없음)
  if (before !== after) {
    closeModal('instEvInfoModal');
    renderInstCal();
  }
}

// 전역 노출
window.chMonInst = chMonInst;
window.renderInstCal = renderInstCal;
window.openVisitModal = openVisitModal;
window.saveVisitRequest = saveVisitRequest;
window.openInstVisitDetail = openInstVisitDetail;
window.cancelMyVisit = cancelMyVisit;
window.renderAdminVisits = renderAdminVisits;
window.setVisitFilter = setVisitFilter;
window.openVisitReview = openVisitReview;
window.approveVisit = approveVisit;
window.rejectVisit = rejectVisit;
window.updateVisitBadge = updateVisitBadge;
window.openInstEvInfo = openInstEvInfo;
window.applyEvFromCal = applyEvFromCal;
window.cancelAppFromCal = cancelAppFromCal;
window.openCancelVisitModal = openCancelVisitModal;
window.confirmCancelVisit = confirmCancelVisit;
window.renderInstVisits = renderInstVisits;
window.setInstVisitFilter = setInstVisitFilter;

window.addEventListener('DOMContentLoaded', () => {
  initApp();
});

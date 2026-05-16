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
  currentUser: null,
  isAdmin: false,
  currentAdminName: null,
  currentNoticeId: null,
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(),
  dayFilter: {},
  editingEventIdx: null,
  editingNoticeId: null,
  unsubInst: null,
  unsubEv: null,
  unsubAdm: null,
  unsubNotices: null,
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
  ['instConnText', 'adminConnText'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  });
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
  }
  if (adminActive) {
    if (source === 'instructors') updatePendingBadge();

    const calPage = document.getElementById('apCalendar');
    if (calPage && calPage.classList.contains('active')) renderCal();
    const schPage = document.getElementById('apSchedule');
    if (schPage && schPage.classList.contains('active')) renderAdminSchedule();
    const instListPage = document.getElementById('apInstructors');
    if (instListPage && instListPage.classList.contains('active')) renderInstList();
    const searchPage = document.getElementById('apSearch');
    if (searchPage && searchPage.classList.contains('active')) searchInst();
    const gradePage = document.getElementById('apGrade');
    if (gradePage && gradePage.classList.contains('active')) renderGradeTab();
    const settingsPage = document.getElementById('apSettings');
    if (settingsPage && settingsPage.classList.contains('active')) renderAdminList();
    const notPage = document.getElementById('apNotices');
    if (notPage && notPage.classList.contains('active')) renderAdminNotices();
    const apprPage = document.getElementById('apApproval');
    if (apprPage && apprPage.classList.contains('active')) renderApprovalList();
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

async function loginInst() {
  if (!S.initialized) { showErr('아직 초기화 중입니다. 잠시 후 다시 시도하세요.'); return; }
  const name = document.getElementById('iName').value.trim();
  const pw = document.getElementById('iPw').value.trim();
  if (!name || !pw) { showErr('이름과 비밀번호를 입력하세요.'); return; }

  showLoading('확인 중...');
  try {
    const hashedPw = await hashPw(pw);

    if (S.instructors[name]) {
      if (S.instructors[name].pw !== hashedPw) {
        hideLoading();
        showErr('비밀번호가 틀렸습니다.');
        return;
      }
      const status = S.instructors[name].status || 'approved';
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
    } else {
      const newProfile = {
        pw: hashedPw, name, email:'', phone:'', addr:'', subject:'',
        eduLevel: '', isMajor: '', manualScore: 0,
        edu: ['','',''], career: ['','','','',''], certs: ['','','','',''],
        days: {}, carOwn: '', appeal: '', applications: {},
        status: 'pending', registeredAt: new Date().toISOString()
      };
      await window.DB.signIn();
      await window.DB.saveInstructor(name, newProfile);
      S.instructors[name] = newProfile;
      try { localStorage.setItem('tff_last_user', name); } catch(e) {}
      hideLoading();
      document.getElementById('iName').value = '';
      document.getElementById('iPw').value = '';
      showErr(
        '✅ 가입 신청이 접수되었습니다!\n' +
        `'${name}' 님의 신청이 관리자에게 전달되었습니다.\n` +
        '관리자가 승인하면 등록하신 비밀번호로 로그인할 수 있습니다.',
        'success'
      );
      return;
    }

    await window.DB.signIn();

    document.getElementById('loginErr').style.display = 'none';
    S.currentUser = name; S.isAdmin = false;
    // 다음 방문 시 로그인 화면 알림에서 "내가 참여한 항목" 필터링에 사용
    try { localStorage.setItem('tff_last_user', name); } catch(e) {}
    hideLoading();
    showScreen('instScreen');
    loadInstProfile();
    renderInstNotices();
    renderInstEvents();
  } catch(e) {
    hideLoading();
    showErr('로그인 실패: ' + e.message);
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
  if (id === 'Search') searchInst();
  if (id === 'Grade') renderGradeTab();
  if (id === 'Settings') renderAdminList();
  if (id === 'System') { refreshLastBackupTime(); renderManualIfShown(); }
  if (id === 'Notices') renderAdminNotices();
  if (id === 'Approval') renderApprovalList();
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
  document.getElementById('instTopName').textContent = S.currentUser + '님';
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
      const d = document.createElement('div');
      d.className = 'ev-item';
      if (isPast) d.style.opacity = '0.55';
      d.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
        <div style="display:flex;align-items:flex-start;flex:1;min-width:0;">
          <span class="type-stripe ${typeCls(ev.type)}"></span>
          <div style="flex:1;min-width:0;">
            <div class="ev-title">[${ev.type}] ${ev.title}${isPast ? ' <span style="font-size:11px;color:var(--text-hint);font-weight:400;">(종료)</span>' : ''}</div>
            <div class="ev-meta">${ev.date}${timeStr ? ' · ' + timeStr : ''} &middot; ${ev.place}</div>
            <div class="ev-desc">${ev.desc || ''}</div>
          </div>
        </div>
        <div style="flex-shrink:0;display:flex;flex-direction:column;gap:5px;align-items:flex-end;">
          ${applied
            ? `<span class="badge ${applied}">${applied==='pending'?'신청중':applied==='approved'?'승인됨':'거절됨'}</span>
               ${isPast ? '' : `<button class="btn sm danger" onclick="cancelApp('${evId}')">신청 취소</button>`}`
            : (isPast
                ? `<span class="badge" style="background:var(--bg);color:var(--text-hint);">종료</span>`
                : `<button class="btn sm primary" onclick="applyEv('${evId}')">신청</button>`)}
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
    const d = document.createElement('div'); d.className = 'ev-item';
    if (isPast) d.style.opacity = '0.55';
    d.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
      <span style="display:flex;align-items:center;flex:1;min-width:0;">
        <span class="type-stripe ${typeCls(ev.type)}"></span>
        <span style="overflow:hidden;text-overflow:ellipsis;">[${ev.type}] ${ev.title} <span style="color:var(--text-sub);">${ev.date}${timeStr ? ' ' + timeStr : ''}</span>${isPast ? ' <span style="font-size:11px;color:var(--text-hint);">(종료)</span>' : ''}</span>
      </span>
      <div class="btn-grp">
        <span class="badge ${status}">${status==='pending'?'검토중':status==='approved'?'승인됨':'거절됨'}</span>
        ${isPast ? '' : `<button class="btn sm danger" onclick="cancelApp('${evId}')">취소</button>`}
      </div>
    </div>`;
    myApp.appendChild(d);
  });
}

async function applyEv(evId) {
  const u = S.instructors[S.currentUser];
  if (!u) return;
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
      const row = document.createElement('div');
      row.className = 'row-item';
      row.style.flexWrap = 'wrap';
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
          <div class="avatar" style="background:var(--amber-light);color:var(--amber);">${_escapeHtml(name.slice(0,1))}</div>
          <div class="inst-info">
            <div class="inst-name">
              ${_escapeHtml(name)}
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
      const row = document.createElement('div');
      row.className = 'row-item';
      row.style.flexWrap = 'wrap';
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
          <div class="avatar" style="background:var(--red-light);color:var(--red);">${_escapeHtml(name.slice(0,1))}</div>
          <div class="inst-info">
            <div class="inst-name">
              ${_escapeHtml(name)}
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

      card.innerHTML = `
        <div class="notice-title-row">
          <span class="badge" style="background:#${({'과학&코딩 캠프':'E6F1FB','특강수업':'E1F5EE','세미나&연수':'FAEEDA','동아리':'F0E7FA','기타사항':'ECECEC'})[ev.type]||'ECECEC'};color:${({'과학&코딩 캠프':'#186E48','특강수업':'#0F6E56','세미나&연수':'#854F0B','동아리':'#6B3FA0','기타사항':'#555'})[ev.type]||'#555'};">${ev.type}</span>
          <span class="notice-title">${_escapeHtml(ev.title)}</span>
        </div>
        <div class="notice-meta">
          ${timeStr ? `<span>🕒 ${timeStr}</span>` : ''}
          <span>📍 ${_escapeHtml(ev.place || '-')}</span>
          <span>👥 신청 ${apps.length}명${approved ? ` (✓${approved})` : ''}${pending ? ` (검토중 ${pending})` : ''}${rejected ? ` (거절 ${rejected})` : ''}</span>
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
    } else {
      await window.DB.addEvent(data);
    }
    hideLoading();
    closeAddEvModal();
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
      row.innerHTML = `<span>${name}</span>
        <div class="btn-grp">
          <span class="badge ${status}">${status==='pending'?'검토중':status==='approved'?'승인됨':'거절됨'}</span>
          ${status==='pending'
            ? `<button class="btn sm primary" onclick="approveApp('${name}','${evId}','approved')">승인</button>
               <button class="btn sm danger" onclick="approveApp('${name}','${evId}','rejected')">거절</button>`
            : ''}
        </div>`;
      apDiv.appendChild(row);
    });
  }
  openModal('evDetailModal');
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
      }
    }
    await window.DB.deleteEvent(evId);
    hideLoading();
    closeModal('evDetailModal');
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
  let names = Object.keys(S.instructors)
    .filter(name => (S.instructors[name].status || 'approved') === 'approved');

  // 정렬 적용
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

  // 정렬 토글 + 인원수 표시
  const sortBar = `
    <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;align-items:center;">
      <span style="font-size:12px;color:var(--text-sub);margin-right:4px;">정렬:</span>
      <button class="btn sm ${_instListSort==='recent'?'primary':''}" onclick="setInstListSort('recent')">최근 등록순</button>
      <button class="btn sm ${_instListSort==='name'?'primary':''}" onclick="setInstListSort('name')">가나다순</button>
      <span style="font-size:12px;color:var(--text-hint);margin-left:auto;">총 ${names.length}명</span>
    </div>`;

  if (!names.length) {
    div.innerHTML = sortBar + '<p class="empty-msg">등록된 강사가 없습니다.</p>';
    return;
  }

  div.innerHTML = sortBar;
  names.forEach(name => {
    const u = getProfile(S.instructors[name]);
    const regDate = _fmtRegDate(u.registeredAt);
    const row = document.createElement('div'); row.className = 'row-item';
    row.innerHTML = `
      <div class="avatar">${name.slice(0,1)}</div>
      <div class="inst-info">
        <div class="inst-name">${name} <span style="font-size:11px;color:var(--text-hint);font-weight:400;margin-left:4px;">📅 ${regDate}</span></div>
        <div class="inst-sub">${u.subject||'과목 미입력'} &middot; ${u.phone||'연락처 미입력'}</div>
      </div>
      <button class="btn sm" onclick="openProfile('${name.replace(/'/g, "\\'")}')">프로필</button>`;
    div.appendChild(row);
  });
}

function initDayFilter() {
  const wrap = document.getElementById('dayFilterBtns');
  if (!wrap) return;
  wrap.innerHTML = '';
  DAYS.forEach(d => {
    ['오전','오후'].forEach(t => {
      const key = d.key + (t === '오전' ? '_am' : '_pm');
      const btn = document.createElement('button');
      btn.className = 'day-filter-btn';
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
  searchInst();
}

function searchInst() {
  const qName = document.getElementById('sName').value.trim().toLowerCase();
  const qSubj = document.getElementById('sSubject').value.trim().toLowerCase();
  const qEdu  = document.getElementById('sEdu').value.trim().toLowerCase();
  const qCert = document.getElementById('sCert').value.trim().toLowerCase();
  const activeDays = Object.keys(S.dayFilter).filter(k => S.dayFilter[k]);

  const div = document.getElementById('searchResults');
  const hasQuery = qName || qSubj || qEdu || qCert || activeDays.length;
  if (!hasQuery) { div.innerHTML = '<p class="empty-msg">검색어를 입력하거나 요일을 선택하세요.</p>'; return; }

  const matches = Object.keys(S.instructors).filter(name => {
    const u = getProfile(S.instructors[name]);
    if (u.status !== 'approved') return false;
    if (qName && !name.toLowerCase().includes(qName)) return false;
    if (qSubj && !(u.subject||'').toLowerCase().includes(qSubj)) return false;
    if (qEdu && !u.edu.some(e => e.toLowerCase().includes(qEdu))) return false;
    if (qCert && !u.certs.some(c => c.toLowerCase().includes(qCert))) return false;
    if (activeDays.length) {
      const hasDay = activeDays.every(key => u.days && u.days[key]);
      if (!hasDay) return false;
    }
    return true;
  });

  if (!matches.length) { div.innerHTML = '<p class="empty-msg">검색 결과가 없습니다.</p>'; return; }
  div.innerHTML = `<div style="font-size:12px;color:var(--text-sub);margin-bottom:8px;">검색 결과 ${matches.length}명</div>`;
  matches.forEach(name => {
    const u = getProfile(S.instructors[name]);
    const dayTags = DAYS.flatMap(d => {
      const tags = [];
      if (u.days[d.key+'_am']) tags.push(`<span class="badge" style="background:#E1F1E8;color:#186E48;margin-right:3px;">${d.label} 오전</span>`);
      if (u.days[d.key+'_pm']) tags.push(`<span class="badge" style="background:var(--teal-light);color:var(--teal);margin-right:3px;">${d.label} 오후</span>`);
      return tags;
    }).join('');
    const row = document.createElement('div'); row.className = 'row-item';
    row.style.flexWrap = 'wrap';
    row.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
        <div class="avatar">${name.slice(0,1)}</div>
        <div class="inst-info">
          <div class="inst-name">${name}</div>
          <div class="inst-sub">${u.subject||'과목 미입력'} &middot; ${u.phone||'연락처 미입력'}</div>
          ${dayTags ? `<div style="margin-top:4px;">${dayTags}</div>` : ''}
        </div>
      </div>
      <button class="btn sm" onclick="openProfile('${name.replace(/'/g, "\\'")}')">프로필</button>`;
    div.appendChild(row);
  });
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
        <span class="badge ${status}">${status==='pending'?'검토중':status==='approved'?'승인됨':'거절됨'}</span>`;
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
    const searchPage = document.getElementById('apSearch');
    if (searchPage && searchPage.classList.contains('active')) searchInst();
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
    closeModal('addAdminModal');
    document.getElementById('newAName').value = '';
    document.getElementById('newAPw').value = '';
    err.style.display = 'none';
    toast('관리자가 추가되었습니다', 'success');
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
    toast('삭제되었습니다', 'success');
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
    } else {
      const data = {
        title, content, priority,
        author: S.currentAdminName || '관리자',
        createdAt: new Date().toISOString(),
        comments: []
      };
      await window.DB.addNotice(data);
    }
    hideLoading();
    closeNoticeForm();
    toast(S.editingNoticeId ? '수정되었습니다' : '공지가 등록되었습니다', 'success');
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
    S.currentNoticeId = null;
    hideLoading();
    closeModal('noticeDetailModal');
    toast('삭제되었습니다', 'success');
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
  const total = nCount + eCount;

  if (total === 0) { wrap.style.display = 'none'; return; }

  wrap.style.display = '';

  // 헤더 요약 텍스트
  const summaryParts = [];
  if (nCount > 0) summaryParts.push(`공지 ${nCount}`);
  if (eCount > 0) summaryParts.push(`일정 ${eCount}`);
  const summary = summaryParts.join(' · ');
  document.getElementById('loginNoticesCount').textContent = hasUser
    ? `새 소식 (${summary})`
    : `등록된 소식 (${summary})`;

  // 펼친 영역: 공지 섹션 + 일정 섹션
  const PRIO_ICON = { urgent: '🔴', important: '🟡', normal: '⚪' };
  const TYPE_ICON = {
    '과학&코딩 캠프': '🔬',
    '특강수업': '✨',
    '세미나&연수': '📖',
    '동아리': '🎨',
    '기타사항': '📌'
  };
  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getMonth()+1)}/${pad(d.getDate())}`;
  };
  const fmtEvDate = (s) => {
    if (!s) return '';
    const parts = s.split('-');
    return parts.length === 3 ? `${parts[1]}/${parts[2]}` : s;
  };

  let html = '';
  if (nCount > 0) {
    html += `<div class="login-section-label">📢 공지사항</div>`;
    const shown = unreadNotices.slice(0, 3);
    html += shown.map(n => `
      <div class="login-notice-item">
        <span class="login-notice-priority">${PRIO_ICON[n.priority] || '⚪'}</span>
        <span class="login-notice-title">${_escapeHtml(n.title || '제목 없음')}</span>
        <span class="login-notice-date">${fmtDate(n.createdAt)}</span>
      </div>`).join('');
    if (nCount > 3) html += `<div class="login-notice-more">외 ${nCount - 3}건</div>`;
  }
  if (eCount > 0) {
    if (nCount > 0) html += `<div class="login-section-divider"></div>`;
    html += `<div class="login-section-label">📅 강의/연수</div>`;
    const shown = unreadEvents.slice(0, 3);
    html += shown.map(ev => `
      <div class="login-notice-item">
        <span class="login-notice-priority">${TYPE_ICON[ev.type] || '📌'}</span>
        <span class="login-notice-title">${_escapeHtml(ev.title || '제목 없음')}</span>
        <span class="login-notice-date">${fmtEvDate(ev.date)}</span>
      </div>`).join('');
    if (eCount > 3) html += `<div class="login-notice-more">외 ${eCount - 3}건</div>`;
  }

  document.getElementById('loginNoticesList').innerHTML = html;
}

function toggleLoginNotices() {
  const list = document.getElementById('loginNoticesList');
  const arrow = document.getElementById('loginNoticesArrow');
  if (!list) return;
  const isHidden = list.style.display === 'none' || list.style.display === '';
  list.style.display = isHidden ? 'block' : 'none';
  if (arrow) arrow.textContent = isHidden ? '▲' : '▼';
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
    wUni: cfgRaw.wUni ?? 10,
    wGrad: cfgRaw.wGrad ?? 20,
    wCar: cfgRaw.wCar ?? 5,
    wMajor: cfgRaw.wMajor ?? 15,
    wClass: cfgRaw.wClass ?? 2,
    wCertTeacher: cfgRaw.wCertTeacher ?? 15,
    wCertLifelong: cfgRaw.wCertLifelong ?? 12,
    wCertYouth: cfgRaw.wCertYouth ?? 8,
    wCertOther: cfgRaw.wCertOther ?? 2
  };
  document.getElementById('wUni').value = config.wUni;
  document.getElementById('wGrad').value = config.wGrad;
  document.getElementById('wCar').value = config.wCar;
  document.getElementById('wMajor').value = config.wMajor;
  document.getElementById('wClass').value = config.wClass;
  document.getElementById('wCertTeacher').value = config.wCertTeacher;
  document.getElementById('wCertLifelong').value = config.wCertLifelong;
  document.getElementById('wCertYouth').value = config.wCertYouth;
  document.getElementById('wCertOther').value = config.wCertOther;

  // 기타 자격증 5종
  const OTHER_CERTS = ['운전면허','국가기술자격증','국가기능사자격증','민간자격증','기타자격증'];

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
      if (u.eduLevel === '대졸') s = Number(config.wUni);
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
    wUni: Number(document.getElementById('wUni').value) || 0,
    wGrad: Number(document.getElementById('wGrad').value) || 0,
    wCar: Number(document.getElementById('wCar').value) || 0,
    wMajor: Number(document.getElementById('wMajor').value) || 0,
    wClass: Number(document.getElementById('wClass').value) || 0,
    wCertTeacher: Number(document.getElementById('wCertTeacher').value) || 0,
    wCertLifelong: Number(document.getElementById('wCertLifelong').value) || 0,
    wCertYouth: Number(document.getElementById('wCertYouth').value) || 0,
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
window.toggleLoginNotices = toggleLoginNotices;
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
window.openModal = openModal;
window.closeModal = closeModal;
window.renderGradeTab = renderGradeTab;
window.saveGradingWeights = saveGradingWeights;
window.saveManualScore = saveManualScore;

window.addEventListener('DOMContentLoaded', () => {
  initApp();
});

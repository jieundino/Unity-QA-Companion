// Unity QA Companion - STEP 3: localStorage 기반 프로젝트 및 이슈 관리
// 외부 서버/DB를 사용하지 않습니다. 저장 데이터는 현재 브라우저에 보관됩니다.

document.addEventListener('DOMContentLoaded', () => {
  const STORAGE_KEY = 'unityQaCompanion.data';
  const SCHEMA_VERSION = 4;
  const $ = (id) => document.getElementById(id);

  const navItems = document.querySelectorAll('.nav-item');
  const viewSections = document.querySelectorAll('.view-section');
  const viewTitle = $('current-view-title');
  navItems.forEach(item => item.addEventListener('click', () => {
    const targetViewId = item.dataset.view;
    navItems.forEach(nav => nav.classList.toggle('active', nav === item));
    viewSections.forEach(section => section.classList.toggle('active', section.id === `view-${targetViewId}`));
    if (viewTitle) viewTitle.textContent = item.textContent.trim();
    if (targetViewId === 'execution') renderExecutionView();
  }));

  const fileInput = $('md-file-input');
  const fileInfoBar = $('file-info-bar');
  const errorAlertBox = $('error-alert-box');
  const emptyState = $('issues-empty-state');
  const resultContainer = $('issues-result-container');
  const issueTableBody = $('issue-table-body');
  const fullRawViewer = $('full-raw-viewer');
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const selectedFileName = $('selected-file-name');
  const selectedFileSize = $('selected-file-size');
  const storageStatus = $('storage-status');

  let db = createEmptyDatabase();
  let activeProjectId = null;
  let selectedIssueId = null;
  let currentParseSummary = { preambleText: '', hasPreamble: false };
  // 손상되었거나 더 높은 버전의 데이터를 실수로 덮어쓰지 않도록 보호합니다.
  let storageWritable = true;

  function createEmptyDatabase() {
    return { schemaVersion: SCHEMA_VERSION, projects: [], issues: [], testCases: [], testRuns: [], bugReports: [], mailDrafts: [], updatedAt: new Date().toISOString() };
  }

  function makeId(prefix) {
    const random = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}-${random}`;
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function activeProject() { return db.projects.find(p => p.id === activeProjectId) || null; }
  function projectIssues() { return db.issues.filter(issue => issue.projectId === activeProjectId); }
  function renderDashboardMetrics() {
    const issues=$('dash-total-issues'),cases=$('dash-total-testcases'),rate=$('dash-pass-rate'),rateDesc=$('dash-pass-desc'),bugs=$('dash-unresolved-bugs'),bugsDesc=$('dash-unresolved-bugs-desc');
    if(!issues)return;
    issues.textContent=(db.issues||[]).length;
    cases.textContent=(db.testCases||[]).length;
    const completed=(db.testRuns||[]).filter(run=>run.result==='PASS'||run.result==='FAIL');
    const passed=completed.filter(run=>run.result==='PASS').length;
    const failed=completed.length-passed;
    if(completed.length){rate.textContent=`${Math.round(passed/completed.length*100)}%`;rateDesc.textContent=`통과 ${passed} · 실패 ${failed} (실행 완료 기준)`;}
    else {rate.textContent='—%';rateDesc.textContent='실행 기록 없음';}
    const allBugs=db.bugReports||[];
    const resolved=allBugs.filter(report=>report.status==='Fixed'||report.status==='Retest Passed').length;
    bugs.textContent=allBugs.length-resolved;
    bugsDesc.textContent=`전체 ${allBugs.length}건 · 수정/재검증 완료 ${resolved}건 제외`;
  }

  function loadDatabase() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        db = createEmptyDatabase();
        storageWritable = true;
        setStorageStatus('저장 데이터가 없습니다. 새 프로젝트를 만들어 주세요.');
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.projects) || !Array.isArray(parsed.issues)) {
        throw new Error('저장 데이터 구조가 올바르지 않습니다.');
      }
      db = {
        schemaVersion: Number(parsed.schemaVersion) || 1,
        projects: parsed.projects,
        issues: parsed.issues,
        testCases: Array.isArray(parsed.testCases) ? parsed.testCases : [],
        testRuns: Array.isArray(parsed.testRuns) ? parsed.testRuns : [],
        bugReports: Array.isArray(parsed.bugReports) ? parsed.bugReports : [],
        mailDrafts: Array.isArray(parsed.mailDrafts) ? parsed.mailDrafts : [],
        updatedAt: parsed.updatedAt || new Date().toISOString()
      };
      // STEP 3의 schemaVersion 1 데이터는 projects/issues/testCases 구조를 유지하므로 그대로 읽고 버전만 갱신합니다. 향후 구조 변경은 여기서 마이그레이션합니다.
      if (db.schemaVersion > SCHEMA_VERSION) {
        storageWritable = false;
        showError(`저장 데이터 버전(${db.schemaVersion})이 이 앱에서 지원하는 버전(${SCHEMA_VERSION})보다 높습니다. 데이터 손상을 막기 위해 저장을 잠갔습니다. 호환되는 앱 버전을 사용하거나 먼저 백업해 주세요.`);
        setStorageStatus('상위 버전 데이터 · 저장 잠금');
      } else {
        storageWritable = true;
      }
      activeProjectId = db.projects[0]?.id || null;
      setStorageStatus('브라우저 저장 데이터 불러오기 완료');
    } catch (error) {
      db = createEmptyDatabase();
      activeProjectId = null;
      storageWritable = false;
      showError(`저장 데이터를 읽지 못했습니다. 데이터 손상을 막기 위해 저장을 잠갔으며 기존 데이터는 자동으로 덮어쓰지 않았습니다. JSON 백업이나 브라우저 저장 데이터를 확인해 주세요. 오류: ${error.message}`);
      setStorageStatus('저장 데이터 읽기 실패');
    }
  }

  function saveDatabase() {
    if (!storageWritable) {
      showError('현재 저장 데이터가 손상되었거나 이 앱보다 높은 버전입니다. 기존 데이터를 덮어쓰지 않도록 저장을 차단했습니다. 먼저 JSON 백업 또는 저장 데이터를 복구해 주세요.');
      setStorageStatus('저장 잠금');
      return false;
    }
    let previousSerialized = null;
    try {
      previousSerialized = localStorage.getItem(STORAGE_KEY);
      db.schemaVersion = SCHEMA_VERSION;
      db.updatedAt = new Date().toISOString();
      const serialized = JSON.stringify(db);
      localStorage.setItem(STORAGE_KEY, serialized);
      // 저장 용량 초과 등 예외를 잡기 위해 실제 기록도 확인합니다.
      const verification = localStorage.getItem(STORAGE_KEY);
      if (verification !== serialized) throw new Error('저장 후 검증에 실패했습니다.');
      setStorageStatus(`저장 완료 · ${new Date().toLocaleTimeString('ko-KR')}`);
      return true;
    } catch (error) {
      // setItem can succeed before a later verification error. Restore the previous
      // byte-for-byte value where possible so a failed save never leaves partial data.
      try {
        if (previousSerialized === null) localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, previousSerialized);
      } catch (_) { /* Storage itself may be unavailable; keep the original error visible. */ }
      showError(`로컬 저장에 실패했습니다. 브라우저 저장 공간 또는 개인정보 설정을 확인해 주세요. 변경 사항은 새로고침 시 사라질 수 있습니다. (${error.name || 'Error'}: ${error.message})`);
      setStorageStatus('저장 실패');
      return false;
    }
  }

  function setStorageStatus(message) { if (storageStatus) storageStatus.textContent = message; }
  function showError(message) { errorAlertBox.textContent = message; errorAlertBox.style.display = 'block'; }
  function hideError() { errorAlertBox.style.display = 'none'; errorAlertBox.textContent = ''; }
  function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(1))} ${units[i]}`;
  }

  // 프로젝트 폼
  const projectSelector = $('project-selector');
  const projectForm = $('project-form');
  const projectIdInput = $('project-id');
  function renderProjectSelector() {
    projectSelector.innerHTML = '';
    if (db.projects.length === 0) {
      const option = document.createElement('option');
      option.value = ''; option.textContent = '프로젝트 없음'; projectSelector.appendChild(option);
      return;
    }
    db.projects.forEach(project => {
      const option = document.createElement('option');
      option.value = project.id; option.textContent = project.name || '(이름 없는 프로젝트)';
      option.selected = project.id === activeProjectId;
      projectSelector.appendChild(option);
    });
  }
  function fillProjectForm(project) {
    projectIdInput.value = project?.id || '';
    $('project-name').value = project?.name || '';
    $('project-description').value = project?.description || '';
    $('project-game-version').value = project?.gameVersion || '';
    $('project-build-version').value = project?.buildVersion || '';
    $('project-created-at').value = project?.createdAt || today();
  }
  projectSelector.addEventListener('change', () => {
    activeProjectId = projectSelector.value || null;
    selectedIssueId = null;
    fillProjectForm(activeProject());
    renderIssues();
    renderTestCases();
    renderExecutionView();
    renderBugReportList();
    updateExportIssueOptions();
    closeTestCaseEditor();
    hideError();
  });
  $('btn-new-project').addEventListener('click', () => {
    activeProjectId = null;
    selectedIssueId = null;
    renderProjectSelector();
    fillProjectForm({ id: makeId('project'), createdAt: today() });
    renderIssues();
    renderTestCases();
    closeTestCaseEditor();
    $('project-name').focus();
  });
  projectForm.addEventListener('submit', (event) => {
    event.preventDefault(); hideError();
    const name = $('project-name').value.trim();
    if (!name) { showError('프로젝트 이름을 입력해 주세요.'); return; }
    const id = projectIdInput.value || makeId('project');
    const existing = db.projects.find(project => project.id === id);
    const project = {
      id, name, description: $('project-description').value.trim(),
      gameVersion: $('project-game-version').value.trim(),
      buildVersion: $('project-build-version').value.trim(),
      createdAt: existing?.createdAt || $('project-created-at').value || today(),
      updatedAt: new Date().toISOString()
    };
    const previousProjects = db.projects.map(item => ({ ...item }));
    const previousActiveProjectId = activeProjectId;
    const previousIndex = db.projects.findIndex(p => p.id === id);
    if (previousIndex >= 0) db.projects[previousIndex] = project;
    else db.projects.push(project);
    activeProjectId = id;
    if (saveDatabase()) {
      renderProjectSelector(); fillProjectForm(project); renderIssues();
      alert(previousIndex >= 0 ? '프로젝트 정보를 수정했습니다.' : '프로젝트를 생성했습니다.');
    } else {
      db.projects = previousProjects;
      activeProjectId = previousActiveProjectId;
      renderProjectSelector(); fillProjectForm(activeProject()); renderIssues();
    }
  });

  // Issues.md 선택 및 파싱
  $('btn-select-file').addEventListener('click', () => {
    if (!activeProject()) {
      showError('먼저 프로젝트 정보를 저장해 주세요. 이슈는 현재 선택한 프로젝트에 연결됩니다.');
      return;
    }
    fileInput.value = ''; fileInput.click();
  });
  fileInput.addEventListener('change', event => {
    const file = event.target.files[0]; if (!file) return;
    hideError();
    if (!activeProject()) { showError('먼저 프로젝트를 저장해 주세요.'); return; }
    if (file.size === 0) { showError('선택한 파일이 비어 있습니다 (0 byte).'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      const text = String(e.target.result || '');
      if (!text.trim()) { showError('파일에 텍스트 내용이 없습니다.'); return; }
      const parsed = parseMarkdownIssues(text);
      fullRawViewer.textContent = text;
      selectedFileName.textContent = file.name;
      selectedFileSize.textContent = formatBytes(file.size);
      fileInfoBar.style.display = 'flex';
      currentParseSummary = { preambleText: parsed.preambleText, hasPreamble: parsed.hasPreamble };
      const incoming = parsed.issues.map((issue, index) => ({
        id: makeId('issue'), projectId: activeProjectId,
        number: issue.explicitNumber || String(index + 1), title: issue.title,
        status: normalizeStatus(issue.explicitStatus), description: issue.body,
        rawMarkdown: issue.rawBlock, source: 'markdown', modified: false,
        sourceFile: file.name, lineStart: issue.lineStart, warnings: issue.warnings,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      }));
      const existing = projectIssues();
      const duplicates = incoming.filter((candidate, index) =>
        existing.some(old => isDuplicate(old, candidate)) ||
        incoming.slice(0, index).some(previous => isDuplicate(previous, candidate))
      );
      let toImport = incoming;
      if (duplicates.length) {
        const sample = duplicates.slice(0, 5).map(item => `• ${item.title}`).join('\n');
        const allow = confirm(`기존 프로젝트에서 중복 가능성이 있는 이슈 ${duplicates.length}건을 발견했습니다.\n\n${sample}${duplicates.length > 5 ? '\n…' : ''}\n\n기존 이슈를 덮어쓰지 않고 별도 이슈로 추가할까요?\n[확인] 중복도 별도 추가 / [취소] 중복 항목 제외`);
        if (!allow) toImport = incoming.filter(candidate => !duplicates.includes(candidate));
      }
      if (!toImport.length) {
        showError('추가할 새 이슈가 없습니다. 중복 항목은 기존 데이터를 덮어쓰지 않고 제외했습니다.');
      } else {
        db.issues.push(...toImport);
        if (saveDatabase()) {
          hideError();
          if (duplicates.length) alert(`이슈 ${toImport.length}건을 추가했습니다. 중복 후보 ${duplicates.length}건은 ${toImport.some(i => duplicates.includes(i)) ? '기존 항목과 별개로 추가했습니다.' : '추가하지 않았습니다.'}`);
        } else {
          // 저장 실패 시 메모리 변경도 롤백해 저장되지 않은 데이터가 저장된 것처럼 보이지 않게 합니다.
          const importedIds = new Set(toImport.map(i => i.id));
          db.issues = db.issues.filter(i => !importedIds.has(i.id));
        }
      }
      updateParsedSummary(parsed.issues.length, parsed.hasPreamble, parsed.issues.reduce((n, issue) => n + issue.warnings.length, 0));
      renderIssues(); switchTab('parsed-view');
    };
    reader.onerror = () => showError('파일을 읽는 도중 오류가 발생했습니다.');
    reader.readAsText(file, 'UTF-8');
  });
  $('btn-clear-file').addEventListener('click', () => {
    fileInput.value = ''; fileInfoBar.style.display = 'none'; fullRawViewer.textContent = '';
    currentParseSummary = { preambleText: '', hasPreamble: false };
    hideError(); switchTab('parsed-view');
  });
  $('btn-copy-raw').addEventListener('click', () => {
    if (!fullRawViewer.textContent) return;
    navigator.clipboard.writeText(fullRawViewer.textContent).then(() => alert('원문 마크다운이 클립보드에 복사되었습니다.')).catch(() => alert('클립보드 복사에 실패했습니다.'));
  });
  tabButtons.forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
  function switchTab(tab) {
    tabButtons.forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
    tabContents.forEach(content => content.classList.toggle('active', content.id === `tab-${tab}`));
  }

  function isDuplicate(a, b) {
    const sameTitle = String(a.title || '').trim().toLocaleLowerCase() === String(b.title || '').trim().toLocaleLowerCase();
    const sameNumber = a.number && b.number && String(a.number) === String(b.number);
    return sameTitle || sameNumber;
  }
  function normalizeStatus(status) {
    if (!status) return '미지정';
    const s = String(status).toLowerCase();
    if (s.includes('closed') || s.includes('resolved') || s.includes('해결') || s.includes('완료')) return 'Closed';
    if (s.includes('progress') || s.includes('진행')) return 'In Progress';
    if (s.includes('open') || s.includes('신규') || s.includes('재현')) return 'Open';
    if (s.includes('보류')) return '보류';
    return status;
  }
  function parseMarkdownIssues(text) {
    const lines = text.split(/\r?\n/), issues = [], preambleLines = [];
    let current = null;
    const headingRegex = /^(#{1,4})\s+(.+)$/;
    const listItemRegex = /^[-*]\s+(.+)$/;
    const hasHeadings = lines.some(line => headingRegex.test(line));
    const seenTitles = new Map();
    lines.forEach((line, index) => {
      const heading = line.match(headingRegex);
      if (hasHeadings ? heading : listItemRegex.test(line)) {
        if (current) { finalizeIssue(current, seenTitles); issues.push(current); }
        const rawTitle = heading ? heading[2].trim() : line.replace(/^[-*]\s+/, '').trim();
        const meta = extractTitleAndMeta(rawTitle);
        current = { lineStart: index + 1, title: meta.cleanTitle || '(제목 없음)', explicitNumber: meta.number, explicitStatus: meta.status, bodyLines: [], rawBlockLines: [line], warnings: [] };
        if (!meta.cleanTitle) current.warnings.push('제목 텍스트를 찾을 수 없습니다.');
      } else if (current) { current.bodyLines.push(line); current.rawBlockLines.push(line); }
      else preambleLines.push(line);
    });
    if (current) { finalizeIssue(current, seenTitles); issues.push(current); }
    const preambleText = preambleLines.join('\n').trim();
    return { issues, preambleText, hasPreamble: preambleText.length > 0 };
  }
  function finalizeIssue(issue, seenTitles) {
    issue.body = issue.bodyLines.join('\n').trim();
    issue.rawBlock = issue.rawBlockLines.join('\n');
    if (!issue.explicitStatus) {
      const match = issue.body.match(/(?:상태|Status)\s*[:：]\s*([가-힣a-zA-Z0-9_-]+)/i);
      if (match) issue.explicitStatus = match[1].trim();
    }
    const key = issue.title.toLowerCase();
    if (seenTitles.has(key)) issue.warnings.push(`동일한 제목의 다른 이슈가 존재합니다. (이전 라인: ${seenTitles.get(key)}행)`);
    else seenTitles.set(key, issue.lineStart);
    if (!issue.body) issue.warnings.push('이슈의 세부 설명(본문)이 비어 있습니다.');
    if (issue.body.length > 2500) issue.warnings.push('설명 텍스트가 매우 깁니다(2,500자 초과). 여러 이슈가 한곳에 묶였는지 확인해 주세요.');
  }
  function extractTitleAndMeta(rawTitle) {
    let cleanTitle = rawTitle, number = null, status = null;
    const numMatch = cleanTitle.match(/(?:#|Issue[-_ ]?|이슈\s*)(\d+)/i);
    if (numMatch) { number = numMatch[1]; cleanTitle = cleanTitle.replace(numMatch[0], '').replace(/\s{2,}/g, ' ').trim(); }
    const statusMatch = cleanTitle.match(/[\[(](Open|Closed|Resolved|In Progress|해결됨?|진행중|보류|대기|재현|신규)[\])]/i);
    if (statusMatch) { status = statusMatch[1]; cleanTitle = cleanTitle.replace(statusMatch[0], '').trim(); }
    cleanTitle = cleanTitle.replace(/^(\*\*|__)(.*?)\1$/, '$2').trim();
    return { cleanTitle, number, status };
  }

  // 이슈 목록/상세 렌더링
  function renderIssues() {
    renderDashboardMetrics();
    if ($('export-issue-select')) updateExportIssueOptions();
    // 이슈 추가/수정/삭제 후 테스트 케이스 화면의 이슈 필터와 프롬프트 선택지를 동기화합니다.
    if (typeof tcTableBody !== 'undefined') renderTestCases();
    const issues = projectIssues();
    const hasCurrentProject = Boolean(activeProject());
    emptyState.style.display = issues.length || fullRawViewer.textContent ? 'none' : 'block';
    if (!hasCurrentProject) {
      emptyState.querySelector('h3').textContent = '프로젝트가 선택되지 않았습니다.';
      emptyState.querySelector('p').textContent = '위에서 프로젝트를 생성하고 저장한 뒤 이슈를 추가해 주세요.';
    } else {
      emptyState.querySelector('h3').textContent = '저장된 이슈가 없습니다.';
      emptyState.querySelector('p').textContent = 'Issues.md 파일을 불러오거나 [이슈 수동 추가] 버튼을 눌러 이슈를 등록해 주세요.';
    }
    resultContainer.style.display = (issues.length || fullRawViewer.textContent) ? 'block' : 'none';
    $('dash-total-issues').textContent = db.issues.length;
    $('count-parsed').textContent = issues.length;
    $('count-unclassified').textContent = currentParseSummary.hasPreamble ? '1' : '0';
    issueTableBody.innerHTML = '';
    if (!issues.length) {
      issueTableBody.innerHTML = '<tr><td colspan="4" class="table-empty">저장된 이슈가 없습니다.</td></tr>';
      clearIssueDetail();
      $('unclassified-container').style.display = 'none';
      return;
    }
    let warningCount = 0;
    issues.forEach((issue, index) => {
      warningCount += (issue.warnings || []).length;
      const tr = document.createElement('tr');
      tr.className = `issue-row${issue.id === selectedIssueId ? ' selected' : ''}`;
      const numberText = issue.number ? `#${issue.number}` : `#${index + 1}`;
      const sourceText = issue.modified ? '수정됨' : issue.source === 'manual' ? '수동' : '원문';
      tr.innerHTML = `<td><span style="font-family:monospace">${escapeHtml(numberText)}</span></td><td><span class="badge ${getStatusClass(issue.status)}">${escapeHtml(issue.status || '미지정')}</span></td><td><strong>${escapeHtml(issue.title)}</strong><small class="row-source">${escapeHtml(sourceText)}</small></td><td style="text-align:center">${issue.warnings?.length ? '<span title="파싱 경고">⚠️</span>' : '—'}</td>`;
      tr.addEventListener('click', () => { selectedIssueId = issue.id; renderIssues(); });
      issueTableBody.appendChild(tr);
    });
    $('chip-warnings').style.display = warningCount ? 'inline-flex' : 'none';
    $('count-warnings').textContent = warningCount;
    if (currentParseSummary.hasPreamble) { $('unclassified-container').style.display = 'block'; $('unclassified-text').textContent = currentParseSummary.preambleText; }
    else $('unclassified-container').style.display = 'none';
    const selected = issues.find(issue => issue.id === selectedIssueId) || issues[0];
    selectedIssueId = selected.id;
    showIssueDetail(selected);
  }
  function clearIssueDetail() {
    $('detail-content').style.display = 'none';
    $('detail-empty').style.display = 'block';
    selectedIssueId = null;
  }
  function showIssueDetail(issue) {
    $('detail-empty').style.display = 'none'; $('detail-content').style.display = 'block';
    $('detail-number').textContent = issue.number ? `원문 번호: #${issue.number}` : `ID: ${issue.id.slice(0, 18)}`;
    $('detail-badge-status').textContent = issue.status || '미지정';
    $('detail-badge-status').className = `badge ${getStatusClass(issue.status)}`;
    $('detail-source-label').textContent = `출처: ${issue.source === 'manual' ? '사용자 수동 입력' : 'Markdown 원문'} · ${issue.modified ? '사용자 수정됨' : '원본 상태 유지'}`;
    $('edit-issue-title').value = issue.title || '';
    $('edit-issue-status').value = ['Open','In Progress','Closed','Resolved','보류','미지정'].includes(issue.status) ? issue.status : '미지정';
    $('edit-issue-description').value = issue.description || '';
    $('detail-raw').textContent = issue.rawMarkdown || '(원본 Markdown이 없는 수동 이슈입니다.)';
    const warnings = issue.warnings || [];
    $('detail-warning-box').style.display = warnings.length ? 'block' : 'none';
    $('detail-warning-box').textContent = warnings.length ? `파싱 유의사항: ${warnings.join(' / ')}` : '';
  }
  function getStatusClass(status) {
    if (!status) return 'badge-default';
    const s = String(status).toLowerCase();
    if (s.includes('open') || s.includes('진행') || s.includes('신규') || s.includes('재현')) return 'badge-open';
    if (s.includes('closed') || s.includes('resolved') || s.includes('해결') || s.includes('완료')) return 'badge-closed';
    return 'badge-default';
  }
  function updateParsedSummary(parsedCount, hasPreamble, warnings) {
    $('count-parsed').textContent = parsedCount;
    $('count-unclassified').textContent = hasPreamble ? 1 : 0;
    $('count-warnings').textContent = warnings;
    $('chip-warnings').style.display = warnings ? 'inline-flex' : 'none';
  }

  $('issue-form').addEventListener('submit', event => {
    event.preventDefault(); hideError();
    const issue = db.issues.find(item => item.id === selectedIssueId && item.projectId === activeProjectId);
    if (!issue) { showError('수정할 이슈를 먼저 선택해 주세요.'); return; }
    const title = $('edit-issue-title').value.trim();
    if (!title) { showError('이슈 제목은 비워둘 수 없습니다.'); return; }
    const newStatus = $('edit-issue-status').value;
    const description = $('edit-issue-description').value.trim();
    const collision = projectIssues().find(other => other.id !== issue.id && isDuplicate(other, { title, number: issue.number }));
    if (collision && !confirm(`같은 제목 또는 번호를 가진 이슈가 있습니다: "${collision.title}"\n그래도 별도 이슈로 수정할까요?`)) return;
    const previousIssue = { ...issue };
    issue.title = title; issue.status = newStatus === '미지정' ? '' : newStatus; issue.description = description;
    issue.modified = true; issue.updatedAt = new Date().toISOString();
    if (saveDatabase()) renderIssues();
    else { Object.assign(issue, previousIssue); renderIssues(); }
  });
  $('btn-reset-issue-edit').addEventListener('click', () => {
    const issue = db.issues.find(item => item.id === selectedIssueId);
    if (issue) showIssueDetail(issue);
  });
  $('btn-delete-issue').addEventListener('click', () => {
    const issue = db.issues.find(item => item.id === selectedIssueId && item.projectId === activeProjectId);
    if (!issue) return;
    if (!confirm(`이 이슈를 삭제할까요?\n\n${issue.title}\n\n삭제한 이슈는 이 브라우저 저장 데이터에서 제거됩니다.`)) return;
    const oldIssues = db.issues;
    const oldSelectedIssueId = selectedIssueId;
    db.issues = db.issues.filter(item => item.id !== issue.id);
    selectedIssueId = null;
    if (saveDatabase()) renderIssues();
    else { db.issues = oldIssues; selectedIssueId = oldSelectedIssueId; renderIssues(); }
  });
  $('btn-add-issue').addEventListener('click', () => {
    if (!activeProject()) { showError('먼저 프로젝트 정보를 저장해 주세요.'); return; }
    const issue = { id: makeId('issue'), projectId: activeProjectId, number: '', title: '새 이슈', status: 'Open', description: '', rawMarkdown: '', source: 'manual', modified: false, warnings: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    db.issues.push(issue); selectedIssueId = issue.id;
    if (saveDatabase()) { renderIssues(); $('edit-issue-title').focus(); }
    else { db.issues = db.issues.filter(item => item.id !== issue.id); selectedIssueId = null; renderIssues(); }
  });

  // STEP 4: 테스트 케이스 관리. 외부 AI 호출은 하지 않고 프롬프트/붙여넣기만 지원합니다.
  let editingTestCaseId = null;
  let previewTestCases = [];
  const tcTableBody = $('tc-table-body');
  const tcPreviewContainer = $('tc-preview-container');

  function projectTestCases() { return db.testCases.filter(tc => tc.projectId === activeProjectId); }
  function relatedIssueLabels(tc) {
    const refs = Array.isArray(tc.relatedIssueIds) ? tc.relatedIssueIds : (tc.relatedIssueId ? [tc.relatedIssueId] : []);
    return refs.map(ref => {
      const issue = db.issues.find(i => i.id === ref && i.projectId === activeProjectId) || db.issues.find(i => i.projectId === activeProjectId && String(i.number || '') === String(ref).replace(/^#/, ''));
      return issue ? `#${issue.number || issue.id.slice(0, 8)} ${issue.title}` : `⚠ ${ref}`;
    }).join(', ') || '—';
  }
  function populateIssueSelects() {
    const issues = projectIssues();
    ['tc-filter-issue', 'tc-prompt-issue'].forEach(id => {
      const select = $(id), previous = select.value;
      const firstLabel = id === 'tc-filter-issue' ? '모든 이슈' : '이슈 선택';
      select.innerHTML = `<option value="">${firstLabel}</option>`;
      issues.forEach(issue => {
        const option = document.createElement('option');
        option.value = issue.id;
        option.textContent = `${issue.number ? `#${issue.number} ` : ''}${issue.title}`;
        select.appendChild(option);
      });
      if (issues.some(issue => issue.id === previous)) select.value = previous;
    });
  }
  function renderTestCases() {
    if (!tcTableBody) return;
    renderDashboardMetrics();
    populateIssueSelects();
    const all = projectTestCases();
    const titleFilter = $('tc-filter-title').value.trim().toLocaleLowerCase();
    const issueFilter = $('tc-filter-issue').value;
    const priorityFilter = $('tc-filter-priority').value;
    const statusFilter = $('tc-filter-status').value;
    const filtered = all.filter(tc => {
      const refs = Array.isArray(tc.relatedIssueIds) ? tc.relatedIssueIds : [];
      return (!titleFilter || String(tc.title || '').toLocaleLowerCase().includes(titleFilter)) &&
        (!issueFilter || refs.includes(issueFilter)) &&
        (!priorityFilter || tc.priority === priorityFilter) &&
        (!statusFilter || tc.status === statusFilter);
    });
    tcTableBody.innerHTML = '';
    $('tc-empty-state').style.display = filtered.length ? 'none' : 'block';
    if (!filtered.length) {
      const tr = document.createElement('tr'); tr.innerHTML = `<td colspan="8" class="table-empty">${activeProject() ? '조건에 맞는 테스트 케이스가 없습니다.' : '먼저 프로젝트를 생성하거나 선택해 주세요.'}</td>`; tcTableBody.appendChild(tr);
    }
    filtered.forEach(tc => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><code>${escapeHtml(tc.id.slice(0, 15))}</code></td><td><strong>${escapeHtml(tc.title || '(제목 없음)')}</strong><small class="row-source">${escapeHtml(tc.purpose || '')}</small></td><td>${escapeHtml(relatedIssueLabels(tc))}</td><td><span class="badge ${tc.priority === 'High' ? 'badge-open' : 'badge-default'}">${escapeHtml(tc.priority || 'Medium')}</span></td><td>${escapeHtml(tc.category || '미분류')}</td><td>${escapeHtml(tc.platform || 'Windows')}</td><td>${escapeHtml(tc.status || 'Draft')}</td><td><div class="tc-row-actions"><button class="btn btn-secondary" data-tc-edit="${escapeHtml(tc.id)}" type="button">편집</button><button class="btn btn-danger" data-tc-delete="${escapeHtml(tc.id)}" type="button">삭제</button></div></td>`;
      tcTableBody.appendChild(tr);
    });
    renderDashboardMetrics();
  }
  function splitLines(value) { return String(value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean); }
  function tcReferenceInput(tc) { return (Array.isArray(tc.relatedIssueIds) ? tc.relatedIssueIds : []).join(', '); }
  function resolveIssueReferences(raw) {
    const refs = String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
    return refs.map(ref => {
      const normalized = ref.replace(/^#/, '');
      const issue = projectIssues().find(i => i.id === ref || (i.number && String(i.number) === normalized));
      return issue ? issue.id : ref;
    });
  }
  function missingIssueReferences(refs) {
    return refs.filter(ref => !db.issues.some(i => i.projectId === activeProjectId && (i.id === ref || (i.number && String(i.number) === String(ref).replace(/^#/, '')))));
  }
  function openTestCaseEditor(tc = null) {
    if (!activeProject()) { showError('먼저 프로젝트 정보를 저장해 주세요. 테스트 케이스는 프로젝트에 연결됩니다.'); return; }
    editingTestCaseId = tc?.id || null;
    $('tc-editor-card').style.display = 'block';
    $('tc-editor-heading').textContent = tc ? '테스트 케이스 수정' : '새 테스트 케이스';
    $('tc-editor-id').textContent = tc ? `ID: ${tc.id}` : '저장 시 자동 생성';
    $('tc-edit-title').value = tc?.title || '';
    $('tc-edit-purpose').value = tc?.purpose || '';
    $('tc-edit-preconditions').value = (tc?.preconditions || []).join('\n');
    $('tc-edit-steps').value = (tc?.steps || []).join('\n');
    $('tc-edit-expected').value = (tc?.expectedResults || []).join('\n');
    $('tc-edit-issues').value = tcReferenceInput(tc);
    $('tc-edit-priority').value = tc?.priority || 'Medium';
    $('tc-edit-category').value = tc?.category || '';
    $('tc-edit-platform').value = tc?.platform || 'Windows';
    $('tc-edit-status').value = tc?.status || 'Draft';
    $('btn-delete-tc').style.display = tc ? 'inline-block' : 'none';
    $('tc-editor-warning').style.display = 'none';
    $('tc-editor-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function closeTestCaseEditor() { $('tc-editor-card').style.display = 'none'; editingTestCaseId = null; }
  $('btn-new-testcase').addEventListener('click', () => openTestCaseEditor());
  $('btn-cancel-tc-edit').addEventListener('click', closeTestCaseEditor);
  ['tc-filter-title', 'tc-filter-issue', 'tc-filter-priority', 'tc-filter-status'].forEach(id => $(id).addEventListener('input', renderTestCases));
  tcTableBody.addEventListener('click', event => {
    const editButton = event.target.closest('[data-tc-edit]');
    const deleteButton = event.target.closest('[data-tc-delete]');
    if (editButton) {
      const tc = projectTestCases().find(item => item.id === editButton.dataset.tcEdit);
      if (tc) openTestCaseEditor(tc);
    }
    if (deleteButton) deleteTestCase(deleteButton.dataset.tcDelete);
  });
  function deleteTestCase(id) {
    const tc = db.testCases.find(item => item.id === id && item.projectId === activeProjectId);
    if (!tc || !confirm(`이 테스트 케이스를 삭제할까요?\n\n${tc.title}\n\n삭제 후에는 저장 데이터에서 제거됩니다.`)) return;
    const old = db.testCases;
    db.testCases = db.testCases.filter(item => item.id !== id);
    if (saveDatabase()) { if (editingTestCaseId === id) closeTestCaseEditor(); renderTestCases(); }
    else { db.testCases = old; renderTestCases(); }
  }
  $('tc-editor-form').addEventListener('submit', event => {
    event.preventDefault(); hideError();
    const refs = resolveIssueReferences($('tc-edit-issues').value);
    const candidate = {
      id: editingTestCaseId || makeId('tc'), projectId: activeProjectId,
      title: $('tc-edit-title').value.trim(), purpose: $('tc-edit-purpose').value.trim(),
      preconditions: splitLines($('tc-edit-preconditions').value), steps: splitLines($('tc-edit-steps').value),
      expectedResults: splitLines($('tc-edit-expected').value), relatedIssueIds: refs,
      priority: $('tc-edit-priority').value, category: $('tc-edit-category').value.trim() || '미분류',
      platform: $('tc-edit-platform').value, status: $('tc-edit-status').value,
      source: editingTestCaseId ? (db.testCases.find(tc => tc.id === editingTestCaseId)?.source || 'manual') : 'manual',
      createdAt: db.testCases.find(tc => tc.id === editingTestCaseId)?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    const missing = [];
    if (!candidate.title) missing.push('테스트 제목');
    if (!candidate.steps.length) missing.push('실행 절차');
    if (!candidate.expectedResults.length) missing.push('기대 결과');
    if (!candidate.relatedIssueIds.length) missing.push('관련 이슈 ID');
    if (missing.length) { showError(`필수 항목을 입력해 주세요: ${missing.join(', ')}`); return; }
    const unknown = missingIssueReferences(candidate.relatedIssueIds);
    if (unknown.length && !confirm(`실제 프로젝트에 존재하지 않는 관련 이슈 ID가 있습니다: ${unknown.join(', ')}\n이 상태로 저장할까요?`)) return;
    const duplicate = projectTestCases().find(tc => tc.id !== candidate.id && String(tc.title).trim().toLowerCase() === candidate.title.toLowerCase());
    if (duplicate && !confirm(`중복 가능성이 있는 테스트 케이스가 있습니다: "${duplicate.title}"\n기존 케이스를 덮어쓰지 않고 별도 항목으로 저장할까요?`)) return;
    const old = db.testCases.map(tc => ({ ...tc }));
    const idx = db.testCases.findIndex(tc => tc.id === candidate.id);
    if (idx >= 0) db.testCases[idx] = candidate; else db.testCases.push(candidate);
    if (saveDatabase()) { closeTestCaseEditor(); renderTestCases(); alert(idx >= 0 ? '테스트 케이스를 수정했습니다.' : '테스트 케이스를 등록했습니다.'); }
    else { db.testCases = old; renderTestCases(); }
  });
  $('btn-delete-tc').addEventListener('click', () => { if (editingTestCaseId) deleteTestCase(editingTestCaseId); });

  function buildPrompt(issue) {
    const issueNo = issue.number ? `#${issue.number}` : '(원문 번호 없음)';
    return `역할: 당신은 Unity 게임의 Windows 데스크톱 빌드 QA 전문가입니다. 아래 이슈를 기반으로 검증 가능한 테스트 케이스를 설계하세요.\n\n` +
`[테스트 대상 이슈]\n- 앱 내부 이슈 ID: ${issue.id}\n- 원문 이슈 번호: ${issueNo}\n- 제목: ${issue.title}\n- 상태: ${issue.status || '미지정'}\n- 설명/본문: ${issue.description || '(설명 없음)'}\n- 관련 메모/원본 Markdown: ${issue.rawMarkdown || issue.description || '(추가 메모 없음)'}\n\n` +
`[필수 테스트 관점]\n1. 이슈의 재현 테스트\n2. 빠른 연속 입력 테스트\n3. 경계값 테스트(확인 가능한 경계가 없으면 가설로 표시)\n4. 상태 전환 테스트\n5. 저장 및 불러오기 테스트(이슈와 관련 있는 경우)\n6. 게임/앱 재실행 테스트\n7. 환경 조건: 입력 장치(키보드/마우스/패드 등), 화면 해상도, 창 모드/전체 화면, 창 포커스 상실·복귀, Windows 환경 등 관련 조건\n\n` +
`[사실성 및 불확실성 규칙]\n- 제공된 정보만으로 확인할 수 없는 게임 동작, 조작 키, UI, 저장 방식, 기대 동작을 사실처럼 만들지 마세요.\n- 모르는 정보는 임의로 확정하지 말고 "가설" 또는 "검증 필요"로 표시하세요.\n- 각 테스트는 독립적으로 재현 가능하도록 작성하고, 기대 결과는 관찰 가능한 표현으로 작성하세요.\n- 실제 프로젝트에 존재하는 관련 이슈 ID는 위 앱 내부 이슈 ID 또는 원문 번호 ${issueNo}를 사용하세요.\n- 결과는 설명문 없이 유효한 JSON만 출력하세요.\n\n` +
`[JSON 출력 형식]\n{\n  "testCases": [\n    {\n      "title": "테스트 제목",\n      "purpose": "테스트 목적",\n      "preconditions": ["사전 조건"],\n      "steps": ["실행 절차 1", "실행 절차 2"],\n      "expectedResults": ["기대 결과"],\n      "relatedIssueIds": ["${issue.id}"],\n      "priority": "High|Medium|Low 중 하나",\n      "category": "재현 테스트/빠른 연속 입력/경계값/상태 전환/저장 및 불러오기/재실행/환경 호환성 등",\n      "platform": "Windows",\n      "status": "Draft",\n      "assumptions": ["가설 또는 검증 필요 항목"]\n    }\n  ]\n}`;
  }
  $('btn-generate-prompt').addEventListener('click', () => {
    const issue = projectIssues().find(item => item.id === $('tc-prompt-issue').value);
    if (!issue) { $('tc-prompt-status').textContent = '먼저 기준 이슈를 선택해 주세요.'; return; }
    $('tc-prompt-text').value = buildPrompt(issue);
    $('tc-prompt-status').textContent = `이슈 ${issue.number ? `#${issue.number}` : issue.id} 기준 프롬프트를 생성했습니다. 외부 AI에 직접 복사해 사용하세요.`;
  });
  $('btn-copy-prompt').addEventListener('click', async () => {
    const text = $('tc-prompt-text').value;
    if (!text.trim()) { $('tc-prompt-status').textContent = '먼저 프롬프트를 생성해 주세요.'; return; }
    try { await navigator.clipboard.writeText(text); $('tc-prompt-status').textContent = '프롬프트를 클립보드에 복사했습니다.'; }
    catch (_) { $('tc-prompt-text').focus(); $('tc-prompt-text').select(); $('tc-prompt-status').textContent = '자동 복사에 실패했습니다. 선택된 텍스트를 Ctrl+C로 복사해 주세요.'; }
  });

  function normalizeAiTestCase(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    let refs = source.relatedIssueIds ?? source.relatedIssueId ?? source.issueIds ?? [];
    if (!Array.isArray(refs)) refs = [refs];
    refs = refs.map(ref => String(ref ?? '').trim()).filter(Boolean).map(ref => {
      const normalized = ref.replace(/^#/, '');
      const issue = projectIssues().find(i => i.id === ref || (i.number && String(i.number) === normalized));
      return issue ? issue.id : ref;
    });
    const arrayify = value => Array.isArray(value) ? value.map(v => String(v ?? '').trim()).filter(Boolean) : (value == null || value === '' ? [] : String(value).split(/\r?\n/).map(v => v.trim()).filter(Boolean));
    return {
      id: makeId('tc'), projectId: activeProjectId,
      title: String(source.title ?? source.testTitle ?? '').trim(),
      purpose: String(source.purpose ?? source.objective ?? '').trim(),
      preconditions: arrayify(source.preconditions ?? source.preconditionsText),
      steps: arrayify(source.steps ?? source.procedure ?? source.executionSteps),
      expectedResults: arrayify(source.expectedResults ?? source.expectedResult ?? source.expected),
      relatedIssueIds: refs, priority: ['High', 'Medium', 'Low'].includes(source.priority) ? source.priority : 'Medium',
      category: String(source.category ?? source.testType ?? '미분류').trim(),
      platform: String(source.platform ?? 'Windows').trim() || 'Windows',
      status: ['Draft', 'Ready', 'Archived'].includes(source.status) ? source.status : 'Draft',
      assumptions: arrayify(source.assumptions), source: 'external-ai-preview', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
  }
  function tcWarnings(tc, draftIndex) {
    const warnings = [];
    if (!tc.title) warnings.push('테스트 제목 누락');
    if (!tc.steps.length) warnings.push('실행 절차 누락');
    if (!tc.expectedResults.length) warnings.push('기대 결과 누락');
    if (!tc.relatedIssueIds.length) warnings.push('관련 이슈 ID 누락');
    const unknown = missingIssueReferences(tc.relatedIssueIds);
    if (unknown.length) warnings.push(`존재하지 않는 관련 이슈 ID: ${unknown.join(', ')}`);
    const duplicate = projectTestCases().find(old => String(old.title || '').trim().toLowerCase() === tc.title.toLowerCase());
    const duplicateInPreview = previewTestCases.some((other, index) => index !== draftIndex && tc.title && other.title.toLowerCase() === tc.title.toLowerCase());
    if (duplicate || duplicateInPreview) warnings.push(`중복 테스트 케이스 의심${duplicate ? `: ${duplicate.title}` : ' (미리보기 내 중복)'}`);
    if (tc.assumptions?.length) warnings.push(`가설/검증 필요: ${tc.assumptions.join('; ')}`);
    return warnings;
  }
  function renderPreviewCards() {
    $('tc-preview-list').innerHTML = '';
    previewTestCases.forEach((tc, index) => {
      const card = document.createElement('div'); card.className = 'tc-preview-card'; card.dataset.previewIndex = index;
      card.innerHTML = `<h4>테스트 케이스 ${index + 1}</h4><div class="tc-preview-grid">
<label>테스트 제목 *<input data-field="title" value="${escapeHtml(tc.title)}"></label>
<label>테스트 목적<textarea data-field="purpose">${escapeHtml(tc.purpose)}</textarea></label>
<label>사전 조건<textarea data-field="preconditions">${escapeHtml(tc.preconditions.join('\n'))}</textarea></label>
<label>실행 절차 *<textarea data-field="steps">${escapeHtml(tc.steps.join('\n'))}</textarea></label>
<label>기대 결과 *<textarea data-field="expectedResults">${escapeHtml(tc.expectedResults.join('\n'))}</textarea></label>
<label>관련 이슈 ID *<input data-field="relatedIssueIds" value="${escapeHtml(tcReferenceInput(tc))}" placeholder="이슈 ID 또는 #번호"></label>
<label>우선순위<select data-field="priority"><option ${tc.priority==='High'?'selected':''}>High</option><option ${tc.priority==='Medium'?'selected':''}>Medium</option><option ${tc.priority==='Low'?'selected':''}>Low</option></select></label>
<label>테스트 분류<input data-field="category" value="${escapeHtml(tc.category)}"></label>
<label>플랫폼<select data-field="platform"><option ${tc.platform==='Windows'?'selected':''}>Windows</option><option ${tc.platform==='Windows 10'?'selected':''}>Windows 10</option><option ${tc.platform==='Windows 11'?'selected':''}>Windows 11</option><option ${tc.platform==='기타'?'selected':''}>기타</option></select></label>
<label>작성 상태<select data-field="status"><option ${tc.status==='Draft'?'selected':''}>Draft</option><option ${tc.status==='Ready'?'selected':''}>Ready</option><option ${tc.status==='Archived'?'selected':''}>Archived</option></select></label>
</div><p class="tc-validation" data-validation></p>`;
      $('tc-preview-list').appendChild(card);
      updatePreviewValidation(index);
    });
    tcPreviewContainer.style.display = previewTestCases.length ? 'block' : 'none';
  }
  function readPreviewCard(card) {
    const index = Number(card.dataset.previewIndex), tc = previewTestCases[index]; if (!tc) return;
    card.querySelectorAll('[data-field]').forEach(input => {
      const field = input.dataset.field;
      if (field === 'preconditions' || field === 'steps' || field === 'expectedResults') tc[field] = splitLines(input.value);
      else if (field === 'relatedIssueIds') tc.relatedIssueIds = resolveIssueReferences(input.value);
      else tc[field] = input.value;
    });
    updatePreviewValidation(index);
  }
  function updatePreviewValidation(index) {
    const card = $('tc-preview-list').querySelector(`[data-preview-index="${index}"]`);
    if (!card || !previewTestCases[index]) return;
    const warnings = tcWarnings(previewTestCases[index], index);
    const el = card.querySelector('[data-validation]');
    el.textContent = warnings.length ? warnings.join(' · ') : '필수 항목이 확인되었습니다.';
    el.classList.toggle('valid', warnings.length === 0);
  }
  $('tc-preview-list').addEventListener('input', event => { const card = event.target.closest('[data-preview-index]'); if (card) readPreviewCard(card); });
  $('tc-preview-list').addEventListener('change', event => { const card = event.target.closest('[data-preview-index]'); if (card) readPreviewCard(card); });
  $('btn-parse-ai-json').addEventListener('click', () => {
    $('tc-json-status').textContent = '';
    if (!activeProject()) { $('tc-json-status').textContent = '먼저 프로젝트를 생성하고 선택해 주세요.'; return; }
    try {
      const parsed = JSON.parse($('tc-ai-json').value);
      const items = Array.isArray(parsed) ? parsed : parsed?.testCases;
      if (!Array.isArray(items)) throw new Error('JSON 최상위 값은 배열이거나 { "testCases": [...] } 형태여야 합니다.');
      if (!items.length) throw new Error('등록할 테스트 케이스가 없습니다.');
      if (items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error('testCases의 각 항목은 JSON 객체여야 합니다.');
      previewTestCases = items.map(normalizeAiTestCase);
      renderPreviewCards();
      const warningCount = previewTestCases.reduce((count, tc, i) => count + tcWarnings(tc, i).length, 0);
      $('tc-json-status').textContent = `미리보기 ${previewTestCases.length}건을 만들었습니다. ${warningCount ? `확인할 경고 ${warningCount}건이 있습니다.` : '필수 항목을 확인했습니다.'}`;
    } catch (error) {
      previewTestCases = []; tcPreviewContainer.style.display = 'none';
      $('tc-json-status').textContent = `JSON을 읽지 못했습니다: ${error.message}`;
    }
  });
  $('btn-register-preview').addEventListener('click', () => {
    if (!previewTestCases.length) return;
    // 현재 DOM 값을 먼저 반영하여 사용자가 미리보기에서 편집한 내용을 등록합니다.
    $('tc-preview-list').querySelectorAll('[data-preview-index]').forEach(readPreviewCard);
    const invalid = previewTestCases.map((tc, index) => ({ tc, index, warnings: tcWarnings(tc, index) })).filter(item => !item.tc.title || !item.tc.steps.length || !item.tc.expectedResults.length || !item.tc.relatedIssueIds.length);
    if (invalid.length) { alert(`필수 항목이 부족한 테스트 케이스 ${invalid.length}건이 있습니다. 제목, 실행 절차, 기대 결과, 관련 이슈 ID를 채워 주세요.`); return; }
    const unknown = [...new Set(previewTestCases.flatMap(tc => missingIssueReferences(tc.relatedIssueIds)))];
    const duplicateWarnings = previewTestCases.flatMap((tc, index) => tcWarnings(tc, index).filter(w => w.includes('중복')));
    if (unknown.length && !confirm(`존재하지 않는 관련 이슈 ID가 있습니다: ${unknown.join(', ')}\n계속 등록할까요?`)) return;
    if (duplicateWarnings.length && !confirm(`중복 가능성이 있는 테스트 케이스가 있습니다. 기존 데이터를 덮어쓰지 않고 새 항목으로 등록할까요?`)) return;
    const old = db.testCases;
    const toAdd = previewTestCases.map(tc => ({ ...tc, source: 'external-ai', updatedAt: new Date().toISOString() }));
    db.testCases = [...db.testCases, ...toAdd];
    if (saveDatabase()) {
      previewTestCases = []; renderPreviewCards(); $('tc-ai-json').value = ''; $('tc-json-status').textContent = `${toAdd.length}건을 등록했습니다.`; renderTestCases();
    } else { db.testCases = old; renderTestCases(); }
  });
  $('btn-clear-preview').addEventListener('click', () => { previewTestCases = []; renderPreviewCards(); $('tc-json-status').textContent = '미리보기를 지웠습니다.'; });

  // STEP 5: 수동 테스트 실행 기록. 매 저장마다 새 testRuns 항목을 추가합니다.
  let selectedRunId = null;
  const runStatusLabels = { 'Not Run': '미실행', PASS: 'PASS · 통과', FAIL: 'FAIL · 실패', BLOCKED: 'BLOCKED · 실행 차단' };
  function projectTestRuns() { return (db.testRuns || []).filter(run => run.projectId === activeProjectId); }
  function testCaseById(id) { return db.testCases.find(tc => tc.id === id && tc.projectId === activeProjectId) || null; }
  function latestRunForTestCase(testCaseId) {
    return projectTestRuns().filter(run => run.testCaseId === testCaseId).sort((a,b) => new Date(b.executedAt) - new Date(a.executedAt))[0] || null;
  }
  function formatRunDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('ko-KR');
  }
  function runBadgeClass(result) {
    if (result === 'PASS') return 'run-pass';
    if (result === 'FAIL') return 'run-fail';
    if (result === 'BLOCKED') return 'run-blocked';
    return 'run-not-run';
  }
  function renderExecutionView() {
    renderDashboardMetrics();
    const tcBody = $('run-testcase-body');
    if (!tcBody) return;
    const cases = projectTestCases();
    const titleFilter = $('run-filter-title').value.trim().toLocaleLowerCase();
    const resultFilter = $('run-filter-result').value;
    tcBody.innerHTML = '';
    const filtered = cases.filter(tc => {
      const latest = latestRunForTestCase(tc.id);
      const result = latest?.result || 'Not Run';
      return (!titleFilter || String(tc.title || '').toLocaleLowerCase().includes(titleFilter)) && (!resultFilter || result === resultFilter);
    });
    $('run-empty-state').style.display = filtered.length ? 'none' : 'block';
    if (!filtered.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="7" class="table-empty">${activeProject() ? '표시할 테스트 케이스가 없습니다.' : '먼저 프로젝트를 생성하거나 선택해 주세요.'}</td>`;
      tcBody.appendChild(tr);
    }
    filtered.forEach(tc => {
      const latest = latestRunForTestCase(tc.id);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><code>${escapeHtml(tc.id.slice(0, 16))}</code></td><td><strong>${escapeHtml(tc.title || '(제목 없음)')}</strong></td><td>${escapeHtml(relatedIssueLabels(tc))}</td><td>${escapeHtml(tc.priority || 'Medium')}</td><td><span class="run-result-badge ${runBadgeClass(latest?.result || 'Not Run')}">${escapeHtml(runStatusLabels[latest?.result || 'Not Run'])}</span></td><td>${escapeHtml(formatRunDate(latest?.executedAt))}</td><td><button class="btn btn-primary" type="button" data-start-run="${escapeHtml(tc.id)}">결과 입력</button></td>`;
      tcBody.appendChild(tr);
    });
    const select = $('run-testcase-select');
    const previous = select.value;
    select.innerHTML = '<option value="">테스트 케이스 선택</option>';
    cases.forEach(tc => {
      const option = document.createElement('option'); option.value = tc.id; option.textContent = `${tc.id.slice(0, 12)} · ${tc.title}`; select.appendChild(option);
    });
    if (cases.some(tc => tc.id === previous)) select.value = previous;
    renderRunHistory();
  }
  function chooseTestCaseForRun(id) {
    const tc = testCaseById(id);
    if (!tc) return;
    $('run-testcase-select').value = id;
    $('run-testcase-id').value = id;
    $('run-selected-tc').textContent = `${tc.id} · ${tc.title}`;
    const project = activeProject();
    $('run-game-version').value = project?.gameVersion || '';
    $('run-build-version').value = project?.buildVersion || '';
    $('run-date').value = new Date().toISOString().slice(0,16);
    $('run-result').value = 'Not Run';
    $('run-actual-result').value = '';
    $('run-notes').value = '';
    $('run-next-notes').value = '';
    $('run-result-guidance').style.display = 'none';
    $('run-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function renderRunHistory() {
    const body = $('run-history-body');
    if (!body) return;
    const runs = projectTestRuns().sort((a,b) => new Date(b.executedAt) - new Date(a.executedAt));
    body.innerHTML = '';
    $('run-history-count').textContent = `${runs.length}건`;
    $('run-history-empty').style.display = runs.length ? 'none' : 'block';
    if (!runs.length) {
      const tr = document.createElement('tr'); tr.innerHTML = '<td colspan="6" class="table-empty">아직 실행 기록이 없습니다.</td>'; body.appendChild(tr);
    }
    runs.forEach(run => {
      const tc = db.testCases.find(item => item.id === run.testCaseId);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><code>${escapeHtml(run.id.slice(0, 18))}</code></td><td>${escapeHtml(tc?.title || run.testCaseTitle || '삭제된 테스트 케이스')}</td><td><span class="run-result-badge ${runBadgeClass(run.result)}">${escapeHtml(runStatusLabels[run.result] || run.result)}</span></td><td>${escapeHtml(formatRunDate(run.executedAt))}</td><td>${escapeHtml(`${run.gameVersion || '—'} / ${run.buildVersion || '—'} · ${run.resolution || '—'}`)}</td><td><button class="btn btn-secondary" type="button" data-run-detail="${escapeHtml(run.id)}">상세</button></td>`;
      body.appendChild(tr);
    });
  }
  function showRunDetail(runId) {
    const run = projectTestRuns().find(item => item.id === runId);
    if (!run) return;
    selectedRunId = run.id;
    const tc = db.testCases.find(item => item.id === run.testCaseId);
    const detail = $('run-detail-content');
    const fields = [
      ['실행 ID', run.id], ['테스트 케이스', tc?.title || run.testCaseTitle || run.testCaseId], ['결과', runStatusLabels[run.result] || run.result],
      ['실행 일시', formatRunDate(run.executedAt)], ['게임 버전', run.gameVersion || '—'], ['빌드 버전', run.buildVersion || '—'],
      ['Windows 환경', run.windowsEnvironment || '—'], ['화면 해상도', run.resolution || '—'], ['실제 결과', run.actualResult || '—'],
      ['메모 / BLOCKED 사유', run.notes || '—'], ['다음 실행 참고 사항', run.nextNotes || '—']
    ];
    detail.innerHTML = fields.map(([label,value]) => `<div class="run-detail-field"><strong>${escapeHtml(label)}</strong><p>${escapeHtml(value).replace(/\n/g,'<br>')}</p></div>`).join('');
    $('run-detail-card').style.display = 'block';
    $('btn-run-to-bug-report').style.display = run.result === 'FAIL' ? 'inline-block' : 'none';
    $('run-compare-content').style.display = 'none';
    $('run-detail-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('run-testcase-body').addEventListener('click', event => {
    const button = event.target.closest('[data-start-run]');
    if (button) chooseTestCaseForRun(button.dataset.startRun);
  });
  $('run-history-body').addEventListener('click', event => {
    const button = event.target.closest('[data-run-detail]');
    if (button) showRunDetail(button.dataset.runDetail);
  });
  $('run-testcase-select').addEventListener('change', event => {
    if (event.target.value) chooseTestCaseForRun(event.target.value);
    else { $('run-testcase-id').value = ''; $('run-selected-tc').textContent = '테스트 케이스를 선택해 주세요.'; }
  });
  $('run-result').addEventListener('change', () => {
    const result = $('run-result').value;
    const guidance = $('run-result-guidance');
    if (result === 'FAIL') {
      guidance.textContent = 'FAIL: 실제 결과와 메모를 입력해 주세요. 실제 결과가 비어 있으면 저장 전 확인합니다. 실패 원인은 자동으로 확정하지 않습니다.';
      guidance.style.display = 'block'; guidance.className = 'alert-box warning';
    } else if (result === 'BLOCKED') {
      guidance.textContent = 'BLOCKED: 테스트를 실행하지 못한 환경 문제나 차단 원인을 메모에 기록하세요. FAIL과 구분되는 상태입니다.';
      guidance.style.display = 'block'; guidance.className = 'alert-box warning';
    } else {
      guidance.style.display = 'none';
    }
  });
  $('run-form').addEventListener('submit', event => {
    event.preventDefault(); hideError();
    const tc = testCaseById($('run-testcase-select').value);
    if (!tc) { showError('실행할 테스트 케이스를 선택해 주세요.'); return; }
    const result = $('run-result').value;
    const actualResult = $('run-actual-result').value.trim();
    const notes = $('run-notes').value.trim();
    if (result === 'FAIL' && !actualResult && !confirm('FAIL 결과의 실제 결과가 비어 있습니다. 관찰 내용을 기록하지 않고 저장할까요?')) return;
    if (result === 'BLOCKED' && !notes && !confirm('BLOCKED 사유나 환경 메모가 비어 있습니다. 원인을 기록하지 않고 저장할까요?')) return;
    const executedAt = new Date($('run-date').value).toISOString();
    const run = {
      id: makeId('run'), projectId: activeProjectId, testCaseId: tc.id, testCaseTitle: tc.title,
      result, executedAt, gameVersion: $('run-game-version').value.trim(), buildVersion: $('run-build-version').value.trim(),
      windowsEnvironment: $('run-windows').value.trim(), resolution: $('run-resolution').value.trim(),
      actualResult, notes, nextNotes: $('run-next-notes').value.trim(), createdAt: new Date().toISOString()
    };
    const oldRuns = [...(db.testRuns || [])];
    db.testRuns = [...(db.testRuns || []), run];
    if (saveDatabase()) {
      renderExecutionView(); showRunDetail(run.id);
      alert('새 테스트 실행 기록을 저장했습니다. 기존 실행 이력은 유지됩니다.');
    } else { db.testRuns = oldRuns; renderExecutionView(); }
  });
  $('btn-reset-run-form').addEventListener('click', () => {
    $('run-form').reset(); $('run-testcase-id').value = ''; $('run-selected-tc').textContent = '테스트 케이스를 선택해 주세요.';
    $('run-date').value = new Date().toISOString().slice(0,16); $('run-windows').value = 'Windows 11'; $('run-resolution').value = '1920 × 1080'; $('run-result-guidance').style.display = 'none';
  });
  ['run-filter-title','run-filter-result'].forEach(id => $(id).addEventListener('input', renderExecutionView));
  $('btn-refresh-execution').addEventListener('click', renderExecutionView);
  $('btn-close-run-detail').addEventListener('click', () => { $('run-detail-card').style.display = 'none'; selectedRunId = null; });
  $('btn-compare-run').addEventListener('click', () => {
    const current = projectTestRuns().find(run => run.id === selectedRunId);
    if (!current) return;
    const previous = projectTestRuns().filter(run => run.testCaseId === current.testCaseId && run.id !== current.id).sort((a,b) => new Date(b.executedAt)-new Date(a.executedAt))[0];
    const box = $('run-compare-content'); box.style.display = 'block';
    if (!previous) { box.textContent = '비교할 이전 실행 기록이 없습니다. 같은 테스트 케이스를 다시 실행하면 비교할 수 있습니다.'; return; }
    const summary = run => `${runStatusLabels[run.result] || run.result}\n실행 일시: ${formatRunDate(run.executedAt)}\n게임/빌드: ${run.gameVersion || '—'} / ${run.buildVersion || '—'}\n실제 결과: ${run.actualResult || '—'}\n메모: ${run.notes || '—'}`;
    box.innerHTML = `<div class="run-compare-grid"><div><h4>최근 선택 기록</h4><pre>${escapeHtml(summary(current))}</pre></div><div><h4>직전 실행 기록</h4><pre>${escapeHtml(summary(previous))}</pre></div></div>`;
  });
  let editingBugReportId = null;
  function bugReportFieldMap() { return {title:'bug-report-title',status:'bug-report-state',severity:'bug-report-severity',priority:'bug-report-priority',relatedIssueId:'bug-report-issue',testCaseId:'bug-report-tc',testRunId:'bug-report-run',gameVersion:'bug-report-game-version',buildVersion:'bug-report-build-version',platform:'bug-report-platform',runtimeEnvironment:'bug-report-runtime',resolution:'bug-report-resolution',frequency:'bug-report-frequency',preconditions:'bug-report-preconditions',reproductionSteps:'bug-report-steps',expectedResult:'bug-report-expected',actualResult:'bug-report-actual',confirmedFacts:'bug-report-facts',suspectedCause:'bug-report-cause',evidenceNotes:'bug-report-notes'}; }
  function bugReportFromForm() {
    const report = { ...((db.bugReports || []).find(item => item.id === editingBugReportId) || {}), id: editingBugReportId || makeId('bug'), projectId: activeProjectId };
    Object.entries(bugReportFieldMap()).forEach(([key,id]) => { report[key] = $(id).value.trim(); });
    report.createdAt ||= new Date().toISOString(); report.updatedAt = new Date().toISOString();
    if (!report.suspectedCause) report.suspectedCause = '원인 미확인';
    return report;
  }
  function bugReportMarkdown(report) {
    const val = (key, fallback='미입력') => String(report[key] || fallback);
    return `# ${val('title')}\n\n## 1. 요약\n- 리포트 ID: ${val('id')}\n- 상태: ${val('status')}\n- 생성 일시: ${formatRunDate(report.createdAt)}\n\n## 2. 환경\n- 게임 버전: ${val('gameVersion')}\n- 빌드 버전: ${val('buildVersion')}\n- 플랫폼: ${val('platform')}\n- 실행 환경: ${val('runtimeEnvironment')}\n- 해상도: ${val('resolution')}\n\n## 3. 사전 조건\n${val('preconditions')}\n\n## 4. 재현 절차\n${val('reproductionSteps')}\n\n## 5. 기대 결과\n${val('expectedResult')}\n\n## 6. 실제 결과\n${val('actualResult')}\n\n## 7. 발생 빈도\n${val('frequency')}\n\n## 8. 심각도와 우선순위\n- 심각도: ${val('severity','선택 필요')}\n- 우선순위: ${val('priority','선택 필요')}\n\n## 9. 관련 테스트 및 이슈\n- 테스트 케이스 ID: ${val('testCaseId')}\n- 테스트 실행 ID: ${val('testRunId')}\n- 관련 이슈 ID: ${val('relatedIssueId')}\n\n## 10. 첨부 증거 또는 추가 메모\n${val('evidenceNotes')}\n\n## 확인된 사실과 원인\n- 확인된 사실: ${val('confirmedFacts')}\n- 원인: ${val('suspectedCause','원인 미확인')}`;
  }
  function renderBugReportList() {
    renderDashboardMetrics();
    const reports=(db.bugReports||[]).filter(report=>report.projectId===activeProjectId).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    const body=$('bug-report-list'); body.innerHTML=''; $('bug-report-empty').style.display=reports.length?'none':'block';
    reports.forEach(report=>{const row=document.createElement('tr');row.innerHTML=`<td><code>${escapeHtml(report.id.slice(0,18))}</code></td><td>${escapeHtml(report.title)}</td><td>${escapeHtml(report.status||'Draft')}</td><td>${escapeHtml(report.severity||'미선택')}</td><td>${escapeHtml(report.priority||'미선택')}</td><td>${escapeHtml(formatRunDate(report.createdAt))}</td><td><button class="btn btn-secondary" data-edit-bug="${escapeHtml(report.id)}">열기</button></td>`;body.appendChild(row);});
    renderMailReportOptions();
  }
  function loadBugReport(report) {
    editingBugReportId=report?.id||null; $('bug-report-editor-heading').textContent=report?'버그 리포트 수정':'버그 리포트 작성'; $('bug-report-id').textContent=report?.id||'저장 전'; $('btn-delete-bug-report').style.display=report?'inline-block':'none';
    Object.entries(bugReportFieldMap()).forEach(([key,id])=>{$(id).value=report?.[key]||'';}); $('bug-report-state').value=report?.status||'Draft'; $('bug-report-preview').textContent=report?bugReportMarkdown(report):'';
    if (report) { $('mail-draft-report').value=report.id; loadMailDraftForReport(report.id); }
  }
  function draftBugReportFromRun(run) {
    const tc=db.testCases.find(item=>item.id===run.testCaseId); loadBugReport(null);
    $('bug-report-issue').value=(tc?.relatedIssueIds||[]).join(', '); $('bug-report-tc').value=run.testCaseId||''; $('bug-report-run').value=run.id||'';
    $('bug-report-game-version').value=run.gameVersion||''; $('bug-report-build-version').value=run.buildVersion||''; $('bug-report-runtime').value=run.windowsEnvironment||''; $('bug-report-resolution').value=run.resolution||'';
    $('bug-report-preconditions').value=(tc?.preconditions||[]).join('\n'); $('bug-report-steps').value=(tc?.steps||[]).map((step,index)=>`${index+1}. ${step}`).join('\n'); $('bug-report-actual').value=run.actualResult||''; $('bug-report-expected').value=(tc?.expectedResults||[]).join('\n');
    $('bug-report-notes').value=[run.notes,run.nextNotes].filter(Boolean).join('\n'); $('bug-report-facts').value=run.actualResult||''; $('bug-report-cause').value='원인 미확인'; $('bug-report-status').textContent='실행 기록에서 확인되는 값만 가져왔습니다. 빈 정보는 직접 입력해 주세요.'; document.querySelector('[data-view="reports"]').click();
  }
  $('btn-run-to-bug-report').addEventListener('click',()=>{const run=projectTestRuns().find(item=>item.id===selectedRunId);if(run?.result==='FAIL')draftBugReportFromRun(run);});
  $('bug-report-form').addEventListener('submit',event=>{event.preventDefault();const report=bugReportFromForm();const old=db.bugReports||[];db.bugReports=editingBugReportId?old.map(item=>item.id===editingBugReportId?report:item):[...old,report];if(saveDatabase()){loadBugReport(report);renderBugReportList();$('bug-report-status').textContent='버그 리포트를 로컬에 저장했습니다.';}else db.bugReports=old;});
  $('bug-report-list').addEventListener('click',event=>{const button=event.target.closest('[data-edit-bug]');if(button){const report=(db.bugReports||[]).find(item=>item.id===button.dataset.editBug&&item.projectId===activeProjectId);if(report)loadBugReport(report);}});
  $('btn-new-bug-report').addEventListener('click',()=>loadBugReport(null)); $('btn-reset-bug-report').addEventListener('click',()=>loadBugReport(null));
  $('btn-delete-bug-report').addEventListener('click',()=>{const report=(db.bugReports||[]).find(item=>item.id===editingBugReportId);if(!report||!confirm(`버그 리포트 ${report.id}를 삭제할까요? 이 작업은 취소할 수 없습니다.`))return;const old=db.bugReports;db.bugReports=old.filter(item=>item.id!==report.id);if(saveDatabase()){loadBugReport(null);renderBugReportList();$('bug-report-status').textContent='리포트를 삭제했습니다.';}else db.bugReports=old;});
  $('btn-open-bug-run').addEventListener('click',()=>{const run=(db.testRuns||[]).find(item=>item.id===$('bug-report-run').value);if(!run){$('bug-report-status').textContent='연결된 실행 기록이 없습니다.';return;}document.querySelector('[data-view="execution"]').click();showRunDetail(run.id);});
  ['bug-report-title','bug-report-state','bug-report-severity','bug-report-priority','bug-report-issue','bug-report-game-version','bug-report-build-version','bug-report-platform','bug-report-runtime','bug-report-resolution','bug-report-frequency','bug-report-preconditions','bug-report-steps','bug-report-expected','bug-report-actual','bug-report-facts','bug-report-cause','bug-report-notes'].forEach(id=>$(id).addEventListener('input',()=>{$('bug-report-preview').textContent=bugReportMarkdown(bugReportFromForm());}));
  $('btn-copy-bug-report').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(bugReportMarkdown(bugReportFromForm()));$('bug-report-status').textContent='Markdown을 복사했습니다.';}catch(_){$('bug-report-status').textContent='클립보드 접근이 제한되었습니다. 필드를 선택해 직접 복사해 주세요.';}});

  function renderMailReportOptions() {
    const select=$('mail-draft-report'); if(!select)return;
    const selected=select.value; select.innerHTML='<option value="">버그 리포트 선택</option>';
    (db.bugReports||[]).filter(report=>report.projectId===activeProjectId).forEach(report=>{const option=document.createElement('option');option.value=report.id;option.textContent=`${report.id.slice(0,14)} · ${report.title||'(제목 없음)'}`;select.appendChild(option);});
    if([...select.options].some(option=>option.value===selected))select.value=selected;
  }
  function mailDraftForReport(report) {
    const missing='미기재';
    const value=key=>String(report[key]||missing);
    const subject=`[수정 요청] ${report.title||'버그 리포트'}`;
    const lines=[
      '안녕하세요,', '', '아래 버그에 대해 확인 및 수정을 요청드립니다.', '',
      `버그 발생 요약: ${value('title')}`,
      `게임 버전: ${value('gameVersion')} · 빌드 버전: ${value('buildVersion')}`,
      `플랫폼: ${value('platform')} · 실행 환경: ${value('runtimeEnvironment')} · 해상도: ${value('resolution')}`,
      `발생 빈도: ${value('frequency')}`,'',
      '재현 절차:', value('reproductionSteps'), '',
      `기대 결과: ${value('expectedResult')}`,
      `실제 결과: ${value('actualResult')}`,
      `심각도: ${value('severity')} · 우선순위: ${value('priority')}`,
      `관련 테스트 케이스: ${value('testCaseId')} · 관련 이슈: ${value('relatedIssueId')}`,
      `첨부 증거 또는 추가 확인 사항: ${value('evidenceNotes')}`,
      `확인된 사실: ${value('confirmedFacts')}`,
      `원인: ${report.suspectedCause&&report.suspectedCause!=='원인 미확인'?`추정(미검증) — ${report.suspectedCause}`:'원인 미확인'}`,'',
      '수정 후 동일한 조건에서 확인할 수 있도록 수정 내용과 확인 결과를 회신 부탁드립니다.','',
      '감사합니다.'
    ];
    return {subject,body:lines.join('\n')};
  }
  function loadMailDraftForReport(reportId) {
    $('mail-draft-subject').value='';$('mail-draft-body').value='';$('mail-draft-recipient').value='';
    if(!reportId)return;
    const draft=(db.mailDrafts||[]).find(item=>item.bugReportId===reportId&&item.projectId===activeProjectId);
    if(draft){$('mail-draft-subject').value=draft.subject||'';$('mail-draft-body').value=draft.body||'';$('mail-draft-recipient').value=draft.recipient||'';$('mail-draft-status').textContent='저장된 초안을 불러왔습니다.';}
  }
  $('mail-draft-report').addEventListener('change',()=>{loadMailDraftForReport($('mail-draft-report').value);if($('mail-draft-report').value&&!((db.mailDrafts||[]).some(item=>item.bugReportId===$('mail-draft-report').value&&item.projectId===activeProjectId)))$('mail-draft-status').textContent='선택한 리포트의 저장 초안이 없습니다. 초안 생성 버튼을 눌러 주세요.';});
  $('btn-generate-mail-draft').addEventListener('click',()=>{
    const report=(db.bugReports||[]).find(item=>item.id===$('mail-draft-report').value&&item.projectId===activeProjectId);
    if(!report){$('mail-draft-status').textContent='먼저 버그 리포트를 선택해 주세요.';return;}
    const saved=(db.mailDrafts||[]).find(item=>item.bugReportId===report.id&&item.projectId===activeProjectId);
    if(saved){loadMailDraftForReport(report.id);return;}
    const draft=mailDraftForReport(report);$('mail-draft-subject').value=draft.subject;$('mail-draft-body').value=draft.body;$('mail-draft-status').textContent='초안을 생성했습니다. 제목과 본문을 검토하고 직접 수정할 수 있습니다.';
  });
  $('btn-save-mail-draft').addEventListener('click',()=>{
    const reportId=$('mail-draft-report').value;const report=(db.bugReports||[]).find(item=>item.id===reportId&&item.projectId===activeProjectId);
    if(!report){$('mail-draft-status').textContent='저장할 버그 리포트를 선택해 주세요.';return;}
    const previous=db.mailDrafts||[];const draft={id:previous.find(item=>item.bugReportId===reportId)?.id||makeId('mail-draft'),projectId:activeProjectId,bugReportId:reportId,recipient:$('mail-draft-recipient').value.trim(),subject:$('mail-draft-subject').value,body:$('mail-draft-body').value,updatedAt:new Date().toISOString()};
    db.mailDrafts=[...previous.filter(item=>item.bugReportId!==reportId),draft];
    if(saveDatabase())$('mail-draft-status').textContent='메일 초안을 로컬에 저장했습니다.';else db.mailDrafts=previous;
  });
  async function copyMailField(field,label){try{await navigator.clipboard.writeText($(field).value);$('mail-draft-status').textContent=`${label}을(를) 복사했습니다.`;}catch(_){$(field).focus();$(field).select();$('mail-draft-status').textContent='복사에 실패했습니다. 선택된 내용을 직접 복사해 주세요.';}}
  $('btn-copy-mail-subject').addEventListener('click',()=>copyMailField('mail-draft-subject','메일 제목'));
  $('btn-copy-mail-body').addEventListener('click',()=>copyMailField('mail-draft-body','메일 초안'));

  // STEP 8: 브라우저 로컬 데이터 내보내기 및 백업/복원.
  const backupActions = document.createElement('div');
  backupActions.className = 'card export-card';
  backupActions.innerHTML = `<div class="card-header"><h2>내보내기 및 백업</h2></div><p class="card-subtitle">내보내기는 브라우저에서 처리하며 저장된 로컬 데이터를 변경하지 않습니다.</p>
    <div class="export-controls"><label>Markdown 범위<select id="export-markdown-scope"><option value="project">전체 프로젝트</option><option value="issues">이슈 목록</option><option value="issue">선택한 이슈</option><option value="testCases">테스트 케이스 목록</option><option value="testRuns">테스트 실행 이력</option><option value="bugReports">버그 리포트</option><option value="mailDrafts">메일 초안</option></select></label><label>이슈 선택<select id="export-issue-select"><option value="">이슈 선택</option></select></label><button class="btn btn-secondary" id="btn-export-markdown" type="button">Markdown 다운로드</button></div>
    <div class="export-controls"><span>CSV 내보내기</span><button class="btn btn-secondary" data-export-csv="issues" type="button">이슈 목록 CSV</button><button class="btn btn-secondary" data-export-csv="testCases" type="button">테스트 케이스 CSV</button><button class="btn btn-secondary" data-export-csv="testRuns" type="button">테스트 실행 CSV</button><button class="btn btn-secondary" data-export-csv="bugReports" type="button">버그 리포트 CSV</button></div>
    <div class="export-controls"><button class="btn btn-primary" id="btn-export-json" type="button">전체 JSON 백업 다운로드</button><button class="btn btn-secondary" id="btn-import-json" type="button">JSON 백업 복원</button><span id="export-status" class="inline-status" role="status"></span><input id="json-backup-input" type="file" accept="application/json,.json" hidden></div>`;
  projectForm.parentElement.appendChild(backupActions);
  function fileSafe(value){return String(value||'project').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1F]/g,'_').replace(/[. ]+$/g,'').trim().slice(0,80)||'project';}
  function downloadFile(name,content,type){try{const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);return true;}catch(error){$('export-status').textContent=`다운로드 실패: ${error.message}`;return false;}}
  function currentProjectRows(key){return (db[key]||[]).filter(row=>row.projectId===activeProjectId);}
  function updateExportIssueOptions(){const select=$('export-issue-select');const selected=select.value;select.innerHTML='<option value="">이슈 선택</option>';projectIssues().forEach(issue=>{const option=document.createElement('option');option.value=issue.id;option.textContent=`${issue.id} · ${issue.title||'(제목 없음)'}`;select.appendChild(option);});if([...select.options].some(option=>option.value===selected))select.value=selected;}
  function markdownSection(title,rows,render){return `## ${title}\n\n${rows.length?rows.map(render).join('\n\n'):'해당 데이터 없음'}\n`;}
  function exportMarkdown(){
    const scope=$('export-markdown-scope').value;const project=activeProject();const projectName=project?.name||'프로젝트';let content=`# ${projectName} · QA 데이터 내보내기\n\n- 프로젝트 ID: ${project?.id||'미기재'}\n- 내보낸 날짜: ${new Date().toLocaleString('ko-KR')}\n`;
    const issueRows=currentProjectRows('issues');const tcRows=currentProjectRows('testCases');const runRows=currentProjectRows('testRuns');const bugRows=currentProjectRows('bugReports');const mailRows=currentProjectRows('mailDrafts');
    const issueRender=i=>`### ${i.title||'(제목 없음)'}\n- ID: ${i.id}\n- 상태: ${i.status||'미기재'}\n- 날짜: ${i.updatedAt||i.createdAt||'미기재'}\n\n${i.description||i.body||'상세 내용 없음'}`;
    const tcRender=t=>`### ${t.title||'(제목 없음)'}\n- 테스트 케이스 ID: ${t.id}\n- 상태: ${t.status||'미기재'}\n- 관련 이슈: ${(t.relatedIssueIds||[]).join(', ')||'미기재'}\n- 날짜: ${t.updatedAt||t.createdAt||'미기재'}\n- 사전 조건: ${(t.preconditions||[]).join('; ')||'미기재'}\n- 절차: ${(t.steps||[]).join('; ')||'미기재'}\n- 기대 결과: ${(t.expectedResults||[]).join('; ')||'미기재'}`;
    const runRender=r=>`### ${r.testCaseTitle||r.testCaseId||'테스트 실행'}\n- 실행 ID: ${r.id}\n- 테스트 케이스 ID: ${r.testCaseId||'미기재'}\n- 결과: ${r.result||'미기재'}\n- 실행 일시: ${r.executedAt||'미기재'}\n- 게임/빌드: ${r.gameVersion||'미기재'} / ${r.buildVersion||'미기재'}\n- 환경: ${r.windowsEnvironment||'미기재'} · ${r.resolution||'미기재'}\n- 실제 결과: ${r.actualResult||'미기재'}\n- 메모: ${r.notes||'미기재'}`;
    const bugRender=b=>`### ${b.title||'(제목 없음)'}\n- 리포트 ID: ${b.id}\n- 상태: ${b.status||'미기재'}\n- 심각도 / 우선순위: ${b.severity||'미기재'} / ${b.priority||'미기재'}\n- 테스트 / 실행 / 이슈 ID: ${b.testCaseId||'미기재'} / ${b.testRunId||'미기재'} / ${b.relatedIssueId||'미기재'}\n- 생성 일시: ${b.createdAt||'미기재'}\n- 환경: ${b.gameVersion||'미기재'} / ${b.buildVersion||'미기재'} · ${b.platform||'미기재'} · ${b.runtimeEnvironment||'미기재'}\n- 재현 절차: ${b.reproductionSteps||'미기재'}\n- 기대 결과: ${b.expectedResult||'미기재'}\n- 실제 결과: ${b.actualResult||'미기재'}\n- 확인된 사실: ${b.confirmedFacts||'미기재'}\n- 원인: ${b.suspectedCause||'원인 미확인'}\n- 추가 메모: ${b.evidenceNotes||'미기재'}`;
    if(scope==='project'){
      content+=`\n## 프로젝트 정보\n\n- 이름: ${project?.name||'미기재'}\n- 설명: ${project?.description||'미기재'}\n- 게임 버전: ${project?.gameVersion||'미기재'}\n- 빌드 버전: ${project?.buildVersion||'미기재'}\n- 생성일: ${project?.createdAt||'미기재'}\n`;
      content+='\n'+markdownSection('이슈',issueRows,issueRender)+'\n'+markdownSection('테스트 케이스',tcRows,tcRender)+'\n'+markdownSection('테스트 실행 결과',runRows,runRender)+'\n'+markdownSection('버그 리포트',bugRows,bugRender);
      content+='\n'+markdownSection('수정 요청 메일 초안',mailRows,m=>`### ${m.subject||'(제목 없음)'}\n- 초안 ID: ${m.id}\n- 관련 버그 리포트: ${m.bugReportId||'미기재'}\n- 수정 일시: ${m.updatedAt||'미기재'}\n\n${m.body||''}`);
    } else if(scope==='issues')content+='\n'+markdownSection('이슈 목록',issueRows,issueRender);
    else if(scope==='issue'){const issue=issueRows.find(i=>i.id===$('export-issue-select').value);if(!issue){$('export-status').textContent='내보낼 이슈를 선택해 주세요.';return;}content+='\n'+issueRender(issue);}
    else if(scope==='testCases')content+='\n'+markdownSection('테스트 케이스 목록',tcRows,tcRender);
    else if(scope==='testRuns')content+='\n'+markdownSection('테스트 실행 결과',runRows,runRender);
    else if(scope==='bugReports')content+='\n'+markdownSection('버그 리포트',bugRows,bugRender);
    else content+='\n'+markdownSection('수정 요청 메일 초안',mailRows,m=>`### ${m.subject||'(제목 없음)'}\n- 초안 ID: ${m.id}\n- 관련 버그 리포트: ${m.bugReportId}\n- 수정 일시: ${m.updatedAt||'미기재'}\n\n${m.body||''}`);
    const count=scope==='project'?1:scope==='issues'?issueRows.length:scope==='issue'?1:scope==='testCases'?tcRows.length:scope==='testRuns'?runRows.length:scope==='bugReports'?bugRows.length:mailRows.length;
    if(!project){$('export-status').textContent='먼저 프로젝트를 선택해 주세요.';return;}if(!count){$('export-status').textContent='선택한 범위에 내보낼 데이터가 없습니다.';return;}
    if(downloadFile(`${fileSafe(projectName)}_${fileSafe(scope)}_${today()}.md`,content,'text/markdown;charset=utf-8'))$('export-status').textContent='Markdown 파일 다운로드를 시작했습니다.';
  }
  const csvColumns={issues:[['ID','id'],['프로젝트 ID','projectId'],['제목','title'],['상태','status'],['내용','description'],['원문 Markdown','rawMarkdown'],['생성일','createdAt'],['수정일','updatedAt']],testCases:[['ID','id'],['프로젝트 ID','projectId'],['제목','title'],['목적','purpose'],['사전 조건','preconditions'],['절차','steps'],['기대 결과','expectedResults'],['관련 이슈 ID','relatedIssueIds'],['우선순위','priority'],['분류','category'],['플랫폼','platform'],['상태','status'],['생성일','createdAt'],['수정일','updatedAt']],testRuns:[['실행 ID','id'],['프로젝트 ID','projectId'],['테스트 케이스 ID','testCaseId'],['테스트 제목','testCaseTitle'],['결과','result'],['실행 일시','executedAt'],['게임 버전','gameVersion'],['빌드 버전','buildVersion'],['Windows 환경','windowsEnvironment'],['해상도','resolution'],['실제 결과','actualResult'],['메모','notes'],['다음 실행 메모','nextNotes']],bugReports:[['리포트 ID','id'],['프로젝트 ID','projectId'],['제목','title'],['상태','status'],['심각도','severity'],['우선순위','priority'],['관련 이슈 ID','relatedIssueId'],['테스트 케이스 ID','testCaseId'],['실행 ID','testRunId'],['게임 버전','gameVersion'],['빌드 버전','buildVersion'],['플랫폼','platform'],['실행 환경','runtimeEnvironment'],['해상도','resolution'],['발생 빈도','frequency'],['사전 조건','preconditions'],['재현 절차','reproductionSteps'],['기대 결과','expectedResult'],['실제 결과','actualResult'],['확인된 사실','confirmedFacts'],['추정 원인','suspectedCause'],['증거/메모','evidenceNotes'],['생성일','createdAt'],['수정일','updatedAt']]};
  function csvCell(value){let text=Array.isArray(value)?value.join('\n'):value&&typeof value==='object'?JSON.stringify(value):String(value??'');return `"${text.replace(/"/g,'""')}"`;}
  function exportCsv(key){const rows=currentProjectRows(key);if(!rows.length){$('export-status').textContent='선택한 CSV 범위에 내보낼 데이터가 없습니다.';return;}const columns=csvColumns[key];const content='\uFEFF'+[columns.map(c=>csvCell(c[0])).join(','),...rows.map(row=>columns.map(([,field])=>csvCell(row[field])).join(','))].join('\r\n');if(downloadFile(`${fileSafe(activeProject()?.name)}_${fileSafe(key)}_${today()}.csv`,content,'text/csv;charset=utf-8'))$('export-status').textContent='CSV 파일 다운로드를 시작했습니다.';}
  $('export-markdown-scope').addEventListener('change',()=>{$('export-issue-select').disabled=$('export-markdown-scope').value!=='issue';});
  $('btn-export-markdown').addEventListener('click',exportMarkdown);backupActions.addEventListener('click',event=>{const button=event.target.closest('[data-export-csv]');if(button)exportCsv(button.dataset.exportCsv);});
  updateExportIssueOptions();$('export-issue-select').disabled=true;
  $('btn-export-json').addEventListener('click', () => {
    const payload={schemaVersion:SCHEMA_VERSION,backupCreatedAt:new Date().toISOString(),projects:db.projects,issues:db.issues,testCases:db.testCases||[],testRuns:db.testRuns||[],bugReports:db.bugReports||[],mailDrafts:db.mailDrafts||[]};
    if(!payload.projects.length){$('export-status').textContent='백업할 프로젝트 데이터가 없습니다.';return;}
    if(downloadFile(`${fileSafe(db.projects.length===1?db.projects[0].name:'all-projects')}_full-backup_${today()}.json`,JSON.stringify(payload,null,2),'application/json;charset=utf-8'))$('export-status').textContent='JSON 백업 다운로드를 시작했습니다.';
  });
  $('btn-import-json').addEventListener('click', () => $('json-backup-input').click());
  $('json-backup-input').addEventListener('change', event => {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(String(reader.result || ''));
        if (!imported || !Array.isArray(imported.projects) || !Array.isArray(imported.issues)) throw new Error('필수 데이터(projects, issues)가 없습니다.');
        if (imported.schemaVersion !== undefined && (!Number.isInteger(imported.schemaVersion) || imported.schemaVersion < 1 || imported.schemaVersion > SCHEMA_VERSION)) throw new Error('지원하지 않는 스키마 버전입니다.');
        if (imported.backupCreatedAt !== undefined && (typeof imported.backupCreatedAt !== 'string' || Number.isNaN(Date.parse(imported.backupCreatedAt)))) throw new Error('백업 생성 일시 형식이 올바르지 않습니다.');
        for (const key of ['testCases','testRuns','bugReports','mailDrafts']) if (imported[key] !== undefined && !Array.isArray(imported[key])) throw new Error(`${key} 데이터는 배열이어야 합니다.`);
        if (imported.projects.some(p => !p || typeof p.id !== 'string' || !p.id.trim() || typeof p.name !== 'string')) throw new Error('프로젝트 항목에 유효한 ID와 이름이 필요합니다.');
        if(new Set(imported.projects.map(project=>project.id)).size!==imported.projects.length)throw new Error('프로젝트 ID가 중복되었습니다.');
        const projectIds=new Set(imported.projects.map(project=>project.id));
        for(const [key,label] of [['issues','이슈'],['testCases','테스트 케이스'],['testRuns','테스트 실행'],['bugReports','버그 리포트'],['mailDrafts','메일 초안']]){
          const rows=imported[key]||[];const seen=new Set();
          for(const row of rows){
            if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.id!=='string'||!row.id.trim()||typeof row.projectId!=='string'||!projectIds.has(row.projectId))throw new Error(`${label} 항목의 ID 또는 프로젝트 연결이 올바르지 않습니다.`);
            if(seen.has(row.id))throw new Error(`${label} ID가 중복되었습니다: ${row.id}`);seen.add(row.id);
          }
        }
        for(const tc of imported.testCases||[])for(const field of ['preconditions','steps','expectedResults','relatedIssueIds'])if(tc[field]!==undefined&&(!Array.isArray(tc[field])||tc[field].some(value=>typeof value!=='string')))throw new Error(`테스트 케이스 ${tc.id}의 ${field} 형식이 올바르지 않습니다.`);
        for(const run of imported.testRuns||[])if(typeof run.testCaseId!=='string'||!run.testCaseId)throw new Error('테스트 실행의 테스트 케이스 ID가 올바르지 않습니다.');
        for(const report of imported.bugReports||[])if(report.testRunId&&typeof report.testRunId!=='string')throw new Error('버그 리포트의 실행 ID 형식이 올바르지 않습니다.');
        for(const draft of imported.mailDrafts||[])if(typeof draft.bugReportId!=='string'||!draft.bugReportId)throw new Error('메일 초안의 관련 버그 리포트 ID가 없습니다.');
        if (!confirm(`JSON 백업을 검증했습니다.\n프로젝트 ${imported.projects.length}개, 이슈 ${imported.issues.length}개가 포함되어 있습니다.\n현재 데이터는 전체 교체됩니다. 복원 전에 현재 데이터를 JSON으로 내보내 별도 백업했는지 확인해 주세요. 계속할까요?`)) return;
        const previous = db;
        const previousStorageWritable = storageWritable;
        db = { schemaVersion: SCHEMA_VERSION, projects: imported.projects, issues: imported.issues, testCases: Array.isArray(imported.testCases) ? imported.testCases : [], testRuns: Array.isArray(imported.testRuns) ? imported.testRuns : [], bugReports: Array.isArray(imported.bugReports) ? imported.bugReports : [], mailDrafts: Array.isArray(imported.mailDrafts) ? imported.mailDrafts : [], updatedAt: new Date().toISOString() };
        storageWritable = true;
        activeProjectId = db.projects[0]?.id || null;
        if (saveDatabase()) { renderProjectSelector(); fillProjectForm(activeProject()); selectedIssueId = null; renderIssues(); renderTestCases(); renderExecutionView(); renderBugReportList(); renderMailReportOptions(); updateExportIssueOptions(); alert('JSON 백업을 복원했습니다.'); }
        else { db = previous; storageWritable = previousStorageWritable; }
      } catch (error) { showError(`JSON 복원에 실패했습니다: ${error.message}`); }
      finally { event.target.value = ''; }
    };
    reader.onerror = () => showError('JSON 파일을 읽지 못했습니다.');
    reader.readAsText(file, 'UTF-8');
  });

  // 초기 화면: 예시 데이터를 자동 삽입하지 않습니다.
  loadDatabase();
  renderProjectSelector();
  fillProjectForm(activeProject());
  renderIssues();
  renderTestCases();
  renderExecutionView();
  renderBugReportList();
  $('run-date').value = new Date().toISOString().slice(0,16);
});

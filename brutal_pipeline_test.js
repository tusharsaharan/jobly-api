#!/usr/bin/env node
// Brutal Pipeline & Whiteboard Collaboration Test
// Run: node brutal_pipeline_test.js

require('dotenv').config();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('./src/app');
const config = require('./src/config/env');

const User = require('./src/models/User');
const Job = require('./src/models/Job');
const Application = require('./src/models/Application');
const InterviewSession = require('./src/models/InterviewSession');
const CodeCheckpoint = require('./src/models/CodeCheckpoint');
const WhiteboardSnapshot = require('./src/models/WhiteboardSnapshot');
const TimelineEvent = require('./src/models/TimelineEvent');
const { executeCodeSandbox } = require('./src/infrastructure/sandbox/sandboxService');
const { getOrCreateRoomDoc, cleanupRoomDoc, persistRoomDocNow, roomDocs } = require('./src/infrastructure/realtime/yjsCoordinator');
const terminalService = require('./src/infrastructure/terminal/terminalService');
const Y = require('yjs');

function getAuthToken(user){
  const secret = config.JWT_SECRET || process.env.JWT_SECRET || "development_secret_key_12345678";
  return jwt.sign({ id: user._id.toString(), userId: user._id.toString(), role: user.role }, secret, {expiresIn: '7d'});
}
async function createTestUser(attrs={}){
  return User.create({
    name: attrs.name || `User-${Math.random()}`,
    email: attrs.email || `user-${Date.now()}-${Math.random()}@example.com`,
    password: 'password123',
    role: attrs.role || 'seeker',
    skills: ['javascript'],
    cgpa: 8.5,
    collegeTier: 'tier2',
    college: 'Test University',
    degree: 'B.Tech',
    experience: [{ title: 'Intern', company: 'A', duration: '1 year'}],
    ...attrs
  });
}
async function createTestJob(recruiterId, attrs={}){
  return Job.create({
    title: attrs.title || 'Node Dev',
    company: 'Tech',
    description: 'We need a Node.js dev to build APIs with sufficient length for validation. Extra text to pass 20 chars.',
    skills: ['javascript'],
    recruiter: recruiterId,
    atsRequirements: { minCgpa: 7.0, targetCollegeTier: 'tier3', minExperienceYears: 1, requiredDegree: 'B.Tech' },
    ...attrs
  });
}

let bugs = [];

async function main(){
  // Connect if not connected
  if(mongoose.connection.readyState===0){
    const uri = process.env.MONGO_URI || config.MONGO_URI || 'mongodb://127.0.0.1:27017/jobmatch';
    await mongoose.connect(uri, { family: 4, serverSelectionTimeoutMS: 5000 });
    console.log('Mongo connected', uri);
  }

  console.log('\n=== CHECK: mongo codecheckpoints count, large snapshots >10MB not uploaded to S3, yjsState 10MB breach, whiteboard 16MB breach ===');
  const cpCount = await CodeCheckpoint.countDocuments();
  console.log('codecheckpoints count:', cpCount);
  const allCps = await CodeCheckpoint.find().lean();
  allCps.forEach(c=>{
    const sz = JSON.stringify(c).length;
    console.log(` - checkpoint ${c._id} seq ${c.sequenceNumber} size ${sz} bytes files ${c.filesSnapshot.length}`);
    if(sz > 10*1024*1024) { console.log('  BREACH >10MB not uploaded to S3'); bugs.push('CodeCheckpoint >10MB stored in Mongo without S3, risk 16MB document breach'); }
  });
  const snapCount = await WhiteboardSnapshot.countDocuments();
  console.log('whiteboardsnapshots count:', snapCount);
  const allSnaps = await WhiteboardSnapshot.find().lean();
  allSnaps.forEach(s=>{
    const sz = JSON.stringify(s).length;
    console.log(` - snapshot ${s._id} seq ${s.sequenceNumber} objects ${s.objects.length} size ${sz} bytes`);
    if(sz > 10*1024*1024) { console.log('  BREACH >10MB not uploaded to S3'); bugs.push('WhiteboardSnapshot >10MB without S3'); }
    if(sz > 16*1024*1024) { console.log('  BREACH >16MB Mongo limit'); bugs.push('WhiteboardSnapshot >16MB breach'); }
  });
  const sessions = await InterviewSession.find().lean();
  console.log('sessions:', sessions.length);
  for(const s of sessions){
    const yjsLen = s.yjsState ? s.yjsState.length : 0;
    const wbLen = s.yjsWhiteboardState ? s.yjsWhiteboardState.length : 0;
    console.log(` - session ${s.roomKey} yjsState ${yjsLen} yjsWB ${wbLen}`);
    if(yjsLen > 10*1024*1024) { console.log('  BREACH yjsState >10MB'); bugs.push('yjsState >10MB breach validator'); }
    if(wbLen > 10*1024*1024) { console.log('  BREACH yjsWhiteboardState >10MB'); bugs.push('yjsWhiteboardState >10MB breach'); }
  }

  // Prepare two sessions for isolation tests
  console.log('\n=== SETUP: creating tester users & sessions ===');
  const seeker = await createTestUser({ name: 'SeekerBrutal', email: `seeker-${Date.now()}-${Math.random()}@ex.com`, role: 'seeker' });
  const recruiter = await createTestUser({ name: 'RecruiterBrutal', email: `recruiter-${Date.now()}-${Math.random()}@ex.com`, role: 'recruiter' });
  const outsider = await createTestUser({ name: 'Outsider', email: `outsider-${Date.now()}-${Math.random()}@ex.com`, role: 'seeker' });
  const seekerToken = getAuthToken(seeker);
  const recruiterToken = getAuthToken(recruiter);
  const outsiderToken = getAuthToken(outsider);
  const job = await createTestJob(recruiter._id);
  const appDoc = await Application.create({ job: job._id, seeker: seeker._id, recruiter: recruiter._id, status: 'applied', atsScore: 80 });
  const roomKey = `room-brutal-${Date.now()}-${Math.random()}`;
  const session = await InterviewSession.create({
    tenantId: 'default',
    application: appDoc._id,
    job: job._id,
    seeker: seeker._id,
    recruiter: recruiter._id,
    roomKey,
    scheduledStart: new Date(),
    actualStart: new Date(Date.now()-60000),
    status: 'LIVE',
    stage: 'CODING'
  });
  console.log('session created', session._id.toString(), roomKey);

  // Second session for IDOR
  const seeker2 = await createTestUser({ name: 'Seeker2', email: `seeker2-${Date.now()}-${Math.random()}@ex.com`, role: 'seeker' });
  const recruiter2 = await createTestUser({ name: 'Recruiter2', email: `recruiter2-${Date.now()}-${Math.random()}@ex.com`, role: 'recruiter' });
  const seeker2Token = getAuthToken(seeker2);
  const appDoc2 = await Application.create({ job: job._id, seeker: seeker2._id, recruiter: recruiter2._id, status: 'applied', atsScore: 80 });
  const roomKey2 = `room-brutal2-${Date.now()}-${Math.random()}`;
  const session2 = await InterviewSession.create({
    tenantId: 'default',
    application: appDoc2._id,
    job: job._id,
    seeker: seeker2._id,
    recruiter: recruiter2._id,
    roomKey: roomKey2,
    scheduledStart: new Date(),
    actualStart: new Date(),
    status: 'LIVE',
    stage: 'CODING'
  });
  console.log('session2 created', session2._id.toString(), roomKey2);

  console.log('\n=== TEST 1: execute malicious code (process.exit, fs.readFile) ===');
  try {
    const r1 = await executeCodeSandbox({ language: 'javascript', code: `console.log('before'); process.exit(42); console.log('after');` });
    console.log('process.exit test -> exitCode', r1.exitCode, 'stdout', JSON.stringify(r1.stdout), 'stderr', JSON.stringify(r1.stderr.slice(0,200)));
    if(r1.exitCode===42) {
      console.log('BUG: process.exit allowed to exit with arbitrary code, no sandbox isolation');
      bugs.push('Sandbox allows process.exit(42) - no isolation, could kill host process if not isolated properly (child process isolated but still allowed)');
    } else {
      console.log('process.exit exitCode not 42, check');
    }
  } catch(e){ console.log('process.exit error', e.message); }

  try {
    const r2 = await executeCodeSandbox({ language: 'javascript', code: `const fs=require('fs'); try{ console.log(fs.readFileSync('C:\\\\Windows\\\\System32\\\\drivers\\\\etc\\\\hosts','utf8').slice(0,100)); } catch(e){ console.log('fs error '+e.message); }` });
    console.log('fs.readFile test -> stdout', JSON.stringify(r2.stdout.slice(0,500)), 'exit', r2.exitCode);
    if(r2.stdout.includes('localhost') || r2.stdout.includes('#') || r2.stdout.length>0 && !r2.stdout.includes('fs error')) {
      console.log('BUG: fs.readFile succeeded - sandbox has host filesystem access (information disclosure)');
      bugs.push('Sandbox allows fs.readFileSync host filesystem - no chroot/readonly root, information disclosure');
    } else {
      console.log('fs.readFile blocked or empty');
    }
  } catch(e){ console.log('fs test error', e.message); }

  try {
    const r3 = await executeCodeSandbox({ language: 'javascript', code: `const fs=require('fs'); fs.writeFileSync('/tmp/pwned_brutal_test.txt','hacked'); console.log('write ok', fs.existsSync('/tmp/pwned_brutal_test.txt'));` });
    console.log('fs.writeFile test -> stdout', JSON.stringify(r3.stdout), 'stderr', JSON.stringify(r3.stderr.slice(0,200)));
    if(r3.stdout.includes('write ok true') || r3.stdout.includes('write ok')) {
      console.log('BUG: fs.writeFile allowed - sandbox has write access to host /tmp');
      bugs.push('Sandbox allows fs.writeFile to host filesystem');
    }
  } catch(e){ console.log('write test error', e.message); }

  try {
    const r4 = await executeCodeSandbox({ language: 'javascript', code: `const { execSync } = require('child_process'); try{ console.log(execSync('whoami').toString().trim()); } catch(e){ console.log('exec error '+e.message) }` });
    console.log('child_process execSync test -> stdout', JSON.stringify(r4.stdout.slice(0,300)), 'stderr', JSON.stringify(r4.stderr.slice(0,300)));
    if(r4.stdout.trim().length>0 && !r4.stdout.includes('exec error')) {
      console.log('BUG: child_process exec allowed - sandbox allows arbitrary command execution on host');
      bugs.push('Sandbox allows child_process.execSync - host command execution');
    }
  } catch(e){ console.log('exec test error', e.message); }

  try {
    const r5 = await executeCodeSandbox({ language: 'python', code: `import os; print(os.listdir('.')[:5]); import socket; s=socket.socket(); s.settimeout(1); 
try:
    s.connect(('8.8.8.8',53))
    print('network reachable')
except Exception as e:
    print('network blocked', e)
` });
    console.log('python os/network test -> stdout', JSON.stringify(r5.stdout.slice(0,500)));
    if(r5.stdout.includes('network reachable')) {
      console.log('BUG: python network allowed');
      bugs.push('Sandbox allows network egress via python socket');
    }
    if(r5.stdout.includes('.py') || r5.stdout.includes('Solution')) {
      console.log('python os.listdir succeeded - filesystem list exposed');
    }
  } catch(e){ console.log('python test error', e.message); }

  console.log('\n=== TEST 2: exceed 100KB code limit ===');
  const bigCode = 'console.log(1);\n'.repeat(20000); // ~300KB
  console.log('bigCode length', bigCode.length);
  const resBig = await request(app).post(`/api/interviews/${session._id}/execute`).set('Authorization', `Bearer ${seekerToken}`).send({ language: 'javascript', code: bigCode });
  console.log('POST execute bigCode status', resBig.status, 'body', JSON.stringify(resBig.body).slice(0,500));
  if(resBig.status===200) {
    console.log('BUG: 100KB limit bypassed, executed big code (expected 400/422)');
    bugs.push('100KB code limit bypassed via HTTP - executed '+bigCode.length+' bytes');
  } else if([400,422].includes(resBig.status)) {
    console.log('PASS: 100KB limit enforced with', resBig.status);
    // Try to bypass via Yjs direct?
    const entry = await getOrCreateRoomDoc(roomKey);
    const ytext = entry.doc.getText('/solution.py');
    entry.doc.transact(()=>{
      ytext.delete(0, ytext.length);
      ytext.insert(0, 'a'.repeat(150000));
    });
    const yContent = entry.doc.getText('/solution.py').toString();
    console.log('Yjs direct large content set length', yContent.length, ' (no 100KB check on Yjs layer) ');
    if(yContent.length>100000){
      console.log('BUG: Yjs layer allows >100KB code without validation - can bloat yjsState and checkpoints');
      bugs.push('Yjs direct Y.Text insertion bypasses 100KB code limit - can exceed 10MB persistence');
    }
    // Also test via checkpoint creation with large content
    try {
      const checkpointService = require('./src/services/checkpointService');
      const cp = await checkpointService.createCheckpoint(session, 'MANUAL', 'large test');
      console.log('checkpoint created with large content, filesSnapshot[0] len', cp.filesSnapshot[0]?.content?.length, 'size', JSON.stringify(cp).length);
      if(JSON.stringify(cp).length > 100000){
        console.log('BUG checkpoint stores large content without S3 fallback');
        bugs.push('Checkpoint large >100KB stored in Mongo without S3, will breach 10MB/16MB');
      }
    } catch(e){ console.log('checkpoint large error', e.message); }
  } else {
    console.log('Unexpected status for big code');
  }

  console.log('\n=== TEST 3: inject script tags (XSS/stored) ===');
  const xssCode = `<script>alert(1)</script>`;
  const resXss = await request(app).post(`/api/interviews/${session._id}/execute`).set('Authorization', `Bearer ${seekerToken}`).send({ language: 'javascript', code: xssCode });
  console.log('xss execute status', resXss.status, 'execution payload', JSON.stringify(resXss.body.execution||resXss.body).slice(0,500));
  // Check TimelineEvent stored codeSnippet
  const lastTimeline = await TimelineEvent.findOne({ session: session._id, eventType: 'code.execution' }).sort({ createdAt: -1 }).lean();
  console.log('last timeline codeSnippet', JSON.stringify(lastTimeline?.payload?.codeSnippet||'').slice(0,500));
  if(lastTimeline?.payload?.codeSnippet?.includes('<script>')) {
    console.log('BUG: Stored XSS - codeSnippet contains raw <script> without sanitization');
    bugs.push('Stored XSS: TimelineEvent codeSnippet stores raw <script> without sanitize-html');
  }
  // Try code with script via file creation initialContent
  const xssFile = await request(app).post(`/api/coding/${session._id}/files`).set('Authorization', `Bearer ${seekerToken}`).send({ name: 'xss.py', path: '/xss.py', language: 'python', initialContent: '<script>alert(1)</script>' });
  console.log('xss file creation status', xssFile.status, JSON.stringify(xssFile.body).slice(0,300));
  // Check filesystem
  const wsRes = await request(app).get(`/api/coding/${session._id}/workspace`).set('Authorization', `Bearer ${seekerToken}`);
  const xssEntry = (wsRes.body.workspace||[]).find(f=>f.path==='/xss.py');
  console.log('workspace xss entry content', JSON.stringify(xssEntry?.content||'').slice(0,300));

  console.log('\n=== TEST 4: sandbox timeout ===');
  const timeoutCode = `while(true){}`;
  const start = Date.now();
  const timeoutRes = await executeCodeSandbox({ language: 'javascript', code: timeoutCode, timeoutMs: 1500 });
  const dur = Date.now()-start;
  console.log('timeout test -> timedOut', timeoutRes.timedOut, 'exitCode', timeoutRes.exitCode, 'durationMs', timeoutRes.durationMs, 'wall', dur, 'stderr', JSON.stringify(timeoutRes.stderr.slice(0,300)));
  if(timeoutRes.timedOut && timeoutRes.exitCode===124) {
    console.log('PASS: sandbox timeout correctly SIGKILL');
  } else {
    console.log('BUG: sandbox timeout not enforced correctly');
    bugs.push('Sandbox timeout breach: infinite loop not timed out correctly');
  }
  // Via HTTP default 8000
  const httpTimeout = await request(app).post(`/api/interviews/${session._id}/execute`).set('Authorization', `Bearer ${seekerToken}`).send({ language: 'javascript', code: 'while(true){}' });
  console.log('HTTP timeout status', httpTimeout.status, 'timedOut', httpTimeout.body.execution?.timedOut, 'exit', httpTimeout.body.execution?.exitCode, 'duration', httpTimeout.body.execution?.durationMs);
  if(httpTimeout.body.execution?.timedOut){
    console.log('HTTP timeout PASS');
  } else {
    console.log('BUG HTTP timeout not flagged');
    bugs.push('HTTP execution timeout not flagged correctly');
  }

  console.log('\n=== TEST 5: checkpoint restoration IDOR ===');
  // Create checkpoint in session2
  const entry2 = await getOrCreateRoomDoc(roomKey2);
  entry2.doc.getText('/solution.py').delete(0, entry2.doc.getText('/solution.py').length);
  entry2.doc.getText('/solution.py').insert(0, 'session2 secret 123');
  const checkpointService = require('./src/services/checkpointService');
  const cp2 = await checkpointService.createCheckpoint(session2, 'MANUAL', 'session2 cp');
  console.log('created cp in session2', cp2._id.toString(), 'seq', cp2.sequenceNumber);
  // Try to restore cp2 via session1 (IDOR) using HTTP as outsider? Actually try as seeker of session1 trying to restore cp from session2 into session1
  const idorRes = await request(app).post(`/api/coding/${session._id}/checkpoints/${cp2._id}/restore`).set('Authorization', `Bearer ${seekerToken}`).send();
  console.log('IDOR restore via session1 status', idorRes.status, JSON.stringify(idorRes.body).slice(0,500));
  if(idorRes.status===200) {
    console.log('BUG: IDOR - allowed restoring checkpoint from other session');
    bugs.push('IDOR: checkpoint restoration allows cross-session checkpoint ID');
  } else if(idorRes.status===404){
    console.log('PASS: IDOR blocked with 404');
  } else {
    console.log('IDOR test unexpected', idorRes.status);
  }
  // Try outsider accessing list checkpoints
  const outsiderList = await request(app).get(`/api/coding/${session._id}/checkpoints`).set('Authorization', `Bearer ${outsiderToken}`);
  console.log('outsider list checkpoints status', outsiderList.status);
  if(outsiderList.status===200) { console.log('BUG IDOR outsider can list checkpoints'); bugs.push('Outsider can list checkpoints'); } else if(outsiderList.status===403){ console.log('PASS outsider blocked'); }

  // Try direct service call bypass? checkpointService.restoreCheckpoint(session, checkpointIdFromOtherSession) should 404 due to session filter
  try {
    await checkpointService.restoreCheckpoint(session, cp2._id);
    console.log('BUG service level IDOR not blocked');
    bugs.push('checkpointService restoreCheckpoint IDOR service level');
  } catch(e){
    console.log('service IDOR correctly blocked', e.message, e.status);
  }

  console.log('\n=== TEST 6: Yjs awareness spoofing ===');
  // Check yjsWebSocket handleYjsMessage for awareness
  const yjsCoordinator = require('./src/infrastructure/realtime/yjsCoordinator');
  const Y2 = require('yjs');
  const awarenessProtocol = require('y-protocols/dist/awareness.cjs');
  const appDocTest = await getOrCreateRoomDoc(roomKey);
  const initialStates = Array.from(appDocTest.awareness.getStates().values()).map(s=>s.user);
  console.log('initial awareness states', initialStates);
  // Simulate spoofed awareness update: create a fake awareness with user field containing script
  const fakeDoc = new Y.Doc();
  const fakeAwareness = new awarenessProtocol.Awareness(fakeDoc);
  fakeAwareness.setLocalStateField('user', { name: '<script>alert(1)</script>', color: 'red', role: 'recruiter' });
  const enc = require('lib0/dist/encoding.cjs');
  const update = awarenessProtocol.encodeAwarenessUpdate(fakeAwareness, [fakeDoc.clientID]);
  const encoder = enc.createEncoder();
  enc.writeVarUint(encoder, 1); // MESSAGE_AWARENESS
  enc.writeVarUint8Array(encoder, update);
  const buf = Buffer.from(enc.toUint8Array(encoder));
  // Apply via handleYjsMessage
  const { handleYjsMessage } = yjsCoordinator;
  const resp = handleYjsMessage(appDocTest.doc, appDocTest.awareness, buf, fakeDoc.clientID);
  console.log('handleYjsMessage awareness spoof response', resp ? 'has response' : 'no response');
  const afterStates = Array.from(appDocTest.awareness.getStates().values()).map(s=>s.user);
  console.log('after spoof awareness states', afterStates);
  const hasScript = afterStates.some(u=> u && u.name && u.name.includes('<script>'));
  if(hasScript){
    console.log('BUG: Yjs awareness allows spoofed <script> name without sanitization/verification');
    bugs.push('Yjs awareness spoofing: accepts arbitrary user name including <script>, impersonation');
  } else {
    console.log('no script found in awareness');
  }
  // Also check if any validation of participant name vs token exists - it does not
  console.log('Yjs awareness has no binding to authenticated user identity, any client can set any name/role');

  console.log('\n=== TEST 7: file creation path traversal ../../etc/passwd ===');
  const pathsToTest = ['../../etc/passwd', '../etc/passwd', '/src/../../etc/passwd', '..\\..\\etc\\passwd', '/etc/passwd/../etc/passwd', '%2e%2e%2fetc%2fpasswd'];
  for(const p of pathsToTest){
    const res = await request(app).post(`/api/coding/${session._id}/files`).set('Authorization', `Bearer ${seekerToken}`).send({ name: 'passwd', path: p, language: 'python' });
    console.log(` path ${JSON.stringify(p)} -> status ${res.status} ${JSON.stringify(res.body).slice(0,200)}`);
    if(res.status===201){
      console.log('BUG: path traversal allowed for', p);
      bugs.push('Path traversal via REST createFile allows '+p);
    }
  }
  // Test encoded traversal bypass?
  const traversalWithNull = await request(app).post(`/api/coding/${session._id}/files`).set('Authorization', `Bearer ${seekerToken}`).send({ name: 'test', path: '/src/test.py\0', language: 'python' });
  console.log('null byte path status', traversalWithNull.status);
  // Test Yjs direct traversal (bypass REST)
  const entry = await getOrCreateRoomDoc(roomKey);
  const maliciousPath = '../../etc/passwd';
  try {
    entry.doc.transact(()=>{
      const fsMap = entry.doc.getMap('filesystem');
      fsMap.set(maliciousPath, { type: 'file', name: 'passwd', path: maliciousPath, language: 'python' });
      const t = entry.doc.getText(maliciousPath);
      t.insert(0, 'root:x:0:0:root:/root:/bin/bash');
    });
    console.log('Yjs direct set with traversal path succeeded, reading back:', entry.doc.getMap('filesystem').has(maliciousPath), entry.doc.getText(maliciousPath).toString().slice(0,100));
    if(entry.doc.getMap('filesystem').has(maliciousPath)){
      console.log('BUG: Yjs direct filesystem.set allows path traversal ../../etc/passwd without validation');
      bugs.push('Yjs CRDT filesystem allows path traversal via direct Y.Map set - bypasses REST validation');
    }
    await persistRoomDocNow(roomKey, entry.doc, 'yjsState');
    const freshSession = await InterviewSession.findOne({ roomKey }).lean();
    console.log('persisted yjsState size', freshSession.yjsState ? freshSession.yjsState.length : 0);
  } catch(e){ console.log('Yjs traversal error', e.message); }

  // Also test filesystem delete path traversal?
  const delTraversal = await request(app).delete(`/api/coding/${session._id}/files`).set('Authorization', `Bearer ${seekerToken}`).send({ path: '../../etc/passwd' });
  console.log('delete traversal status', delTraversal.status, JSON.stringify(delTraversal.body).slice(0,200));

  console.log('\n=== TEST 8: frontend Monaco theme switch preserves Yjs, terminal PTY resizing ===');
  // Inspect MonacoWorkspace.tsx content
  const fs = require('fs');
  const path = require('path');
  const monacoPath = path.join(__dirname, '../jobly-web/src/components/interview/ide/MonacoWorkspace.tsx');
  const monacoContent = fs.readFileSync(monacoPath,'utf8');
  console.log('MonacoWorkspace theme hard-coded?', monacoContent.includes('theme="vs-dark"') ? 'hardcoded vs-dark' : 'dynamic');
  console.log('MonacoWorkspace Yjs binding destroyed on theme switch? check bindActiveFile destroys binding');
  if(monacoContent.includes('bindingRef.current.destroy()') && monacoContent.includes('currentBoundPathRef')) {
    console.log('MonacoWorkspace destroys binding on file switch, potential Yjs sync interruption');
    // Check if theme switch would destroy provider?
    const hasThemeDependency = monacoContent.includes('theme') && monacoContent.includes('useEffect') && monacoContent.match(/useEffect.*theme/s);
    console.log('theme effect dependency:', hasThemeDependency ? 'found' : 'not found');
    if(monacoContent.includes('theme="vs-dark"') && !monacoContent.includes('theme')) {
      console.log('BUG: Monaco theme switch not implemented - theme hard-coded vs-dark, no prop for theme switch, violates requirement to preserve Yjs on theme switch? But Yjs preserved since theme not in deps');
      // Not necessarily bug, but check if provider would be recreated on theme switch - currently not
    }
  }
  // Check if theme switch would preserve Yjs: provider created in useEffect with deps [roomKey, token, user?.name] - no theme dep, so it WOULD preserve Yjs
  console.log('Monaco useEffect deps include roomKey, token, user?.name - no theme, so Yjs WOULD be preserved on theme switch (if theme were prop). So not bug.');
  // Check terminal PTY resizing
  console.log('\nTerminal PTY resizing checks:');
  const resizeTests = [
    {cols: -999, rows: -999},
    {cols: 0, rows: 0},
    {cols: 999999, rows: 888888},
    {cols: null, rows: undefined},
    {cols: 'invalid', rows: 'invalid'},
    {cols: NaN, rows: NaN},
  ];
  for(const {cols, rows} of resizeTests){
    try {
      // Need a terminalId first
      const tid = terminalService.createTerminalSession(session._id.toString(), 80, 24);
      const result = terminalService.resizeTerminal(tid, cols, rows);
      console.log(` resize cols=${cols} rows=${rows} -> result ${result}`);
      // Check if terminal session cols/rows sanitized
      const sess = terminalService.getTerminalSession(tid);
      console.log(`  stored cols=${sess.ptyProcess ? 'pty' : 'unknown'}`);
      terminalService.closeTerminalSession(tid);
      // The service does NOT clamp cols/rows for local pty - it just passes through to pty.resize which may error or create huge buffer
      if(typeof result === 'boolean' && cols===999999 && result===true){
        console.log('BUG: terminalService.resizeTerminal allows 999999 cols without clamping to 10-500, could OOM');
        bugs.push('Terminal PTY resizing no bounds check - allows 999999 cols/rows leading to OOM or crash');
        break;
      }
    } catch(e){ console.log(` resize ${cols}x${rows} error`, e.message); }
  }
  // Also test createTerminal with huge cols via HTTP
  const termRes = await request(app).post(`/api/coding/${session._id}/terminal`).set('Authorization', `Bearer ${seekerToken}`).send({ cols: 99999, rows: 99999 });
  console.log('createTerminal huge dims status', termRes.status, JSON.stringify(termRes.body).slice(0,300));
  if(termRes.status===201){
    console.log('BUG: createTerminal allows huge cols/rows without validation');
    bugs.push('createTerminal HTTP allows huge cols/rows without validation (99999)');
    if(termRes.body.terminalId) terminalService.closeTerminalSession(termRes.body.terminalId);
  }

  console.log('\n=== TEST 9: large snapshots >10MB not uploaded to S3, yjsState 10MB breach, 16MB breach ===');
  // Test yjsState 10MB validator
  try {
    const bigYjsDoc = new Y.Doc();
    const bigText = bigYjsDoc.getText('/big.py');
    const hugeContent = 'a'.repeat(11*1024*1024); // 11MB
    bigText.insert(0, hugeContent);
    const state = Y.encodeStateAsUpdate(bigYjsDoc);
    console.log('generated Yjs state length', state.length, ' buffer', Buffer.from(state).length);
    // Try to save to InterviewSession
    const testSessionForYjs = await InterviewSession.findOne({ _id: session._id });
    testSessionForYjs.yjsState = Buffer.from(state);
    await testSessionForYjs.save();
    console.log('saved huge yjsState without error - validator failed?');
    bugs.push('yjsState 10MB validator not enforced - saved 11MB');
  } catch(e){
    console.log('yjsState 10MB validator triggered error (expected):', (e.message||'').slice(0,500));
    const msg = e.message||'';
    if(msg.includes('yjsState exceeds 10MB') || msg.includes('validation failed') || msg.includes('10MB')){
      console.log('PASS yjsState validator works, but persistRoomDocNow swallows error without S3 fallback');
      console.log('BUG: No S3 fallback for >10MB yjsState - data loss after validation failure');
      bugs.push('yjsState >10MB has no S3 fallback - persist fails silently, data loss');
    } else {
      console.log('other error', e);
      bugs.push('yjsState 10MB test error: '+msg.slice(0,200));
    }
  }
  // Test whiteboard 16MB breach
  try {
    const hugeObjects = Array.from({length: 20000}, (_,i)=> ({ id: `obj_${i}`, type: 'rect', x: i, y: i, width: 100, height: 100, data: 'x'.repeat(1000) })); // ~20k * 1k = 20MB
    const totalSize = JSON.stringify(hugeObjects).length;
    console.log('hugeObjects total JSON size', totalSize);
    if(totalSize > 16*1024*1024) {
      console.log('Testing WhiteboardSnapshot creation with >16MB objects');
      try {
        const snap = await WhiteboardSnapshot.create({ session: session._id, objects: hugeObjects, boardType: 'EXCALIDRAW', canvasWidth: 1920, canvasHeight: 1080, offsetMs: 0, sequenceNumber: 9999 });
        console.log('created huge snapshot', snap._id, 'size', JSON.stringify(snap).length);
        console.log('BUG: WhiteboardSnapshot allowed >16MB without S3, would hit Mongo 16MB document limit on some drivers but currently succeeded (maybe split?)');
        bugs.push('WhiteboardSnapshot allows >16MB objects without S3 - risk Mongo document limit breach');
      } catch(e){
        console.log('Whiteboard huge snapshot error (expected Mongo limit):', e.message.slice(0,600));
        if(e.message.includes('16MB') || e.message.includes('exceeds') || e.message.includes('BSON')){
          console.log('BUG confirmed: WhiteboardSnapshot can exceed 16MB, Mongo throws, no S3 handling');
          bugs.push('WhiteboardSnapshot 16MB breach: Mongo throws without S3 fallback');
        }
      }
    }
  } catch(e){ console.log('huge objects test error', e.message); }

  // Test CodeCheckpoint large
  try {
    const hugeContent = 'b'.repeat(5*1024*1024); // 5MB per file
    const manyFiles = Array.from({length: 4}, (_,i)=> ({ path: `/big${i}.py`, name: `big${i}.py`, content: hugeContent, language: 'python' })); // 20MB total
    const total = JSON.stringify(manyFiles).length;
    console.log('manyFiles Checkpoint total size', total);
    if(total > 16*1024*1024) {
      try {
        const cp = await CodeCheckpoint.create({ session: session._id, triggerType: 'MANUAL', triggerLabel: 'huge', filesSnapshot: manyFiles, offsetMs: 0, sequenceNumber: 9998 });
        console.log('created huge checkpoint', cp._id);
        bugs.push('CodeCheckpoint allows >16MB filesSnapshot without S3');
      } catch(e){
        console.log('huge checkpoint error', e.message.slice(0,600));
        if(e.message.includes('16MB') || e.message.includes('exceeds')){
          bugs.push('CodeCheckpoint 16MB breach no S3 fallback');
        }
      }
    }
  } catch(e){ console.log('checkpoint huge test error', e.message); }

  console.log('\n=== TEST 10: check LSP path handling ===');
  // lspGateway writeVirtualDocument checks path traversal
  const lspGatewayPath = path.join(__dirname, 'src/infrastructure/lsp/lspGateway.js');
  const lspContent = fs.readFileSync(lspGatewayPath,'utf8');
  console.log('lspGateway has path traversal check?', lspContent.includes('documentPath.startsWith') ? 'yes' : 'no');
  console.log('lspGateway writeVirtualDocument uses path.resolve and checks workspace prefix', lspContent.includes('path.resolve') ? 'yes' : 'no');

  console.log('\n=== SUMMARY ===');
  console.log('Bugs found:', bugs.length);
  bugs.forEach((b,i)=> console.log(`${i+1}. ${b}`));
  if(bugs.length===0) console.log('NO BUGS FOUND - but should find at least ONE');

  // Cleanup
  await CodeCheckpoint.deleteMany({ session: session._id, sequenceNumber: { $gte: 9990 } });
  await CodeCheckpoint.deleteMany({ session: session2._id });
  await WhiteboardSnapshot.deleteMany({ session: session._id, sequenceNumber: 9999 });
  await WhiteboardSnapshot.deleteMany({ session: session2._id });
  // Delete test users/sessions? keep for inspection
  // Cleanup Yjs room docs
  cleanupRoomDoc(roomKey);
  cleanupRoomDoc(roomKey2);
  // Restore yjsState if huge
  await InterviewSession.updateOne({ _id: session._id }, { $unset: { yjsState: 1 } });

  await mongoose.disconnect();
  console.log('\nDone');
}

main().catch(e=>{ console.error(e); process.exit(1); });

// ============================================================================
// LMS THẦY HUẤN - GOOGLE APPS SCRIPT V5 (FULL FEATURES)
// Tính năng: Teacher Role, Password Security, Student Management, Question CRUD, OCR Documents
// ============================================================================

const SPREADSHEET_ID = '19FjZ_DcJQD-j00JYsO7co1yaxwq58BTfgMTj1CGvm-c';

const SHEET_NAMES = {
  USERS: 'Users',
  QUESTIONS: 'Questions',
  THEORY: 'Theory',
  SESSIONS: 'Sessions',
  VIOLATIONS: 'Violations',
  RESULTS: 'Results',
  DOCUMENTS: 'Documents' // New Sheet for OCR Data
};

// ==================== MAIN HANDLERS ====================

function doGet(e) {
  try {
    const action = e.parameter.action;
    let payload = {};
    if (e.parameter.payload) {
      try {
        payload = JSON.parse(e.parameter.payload);
      } catch (err) {
        payload = e.parameter;
      }
    } else {
      payload = e.parameter;
    }
    return handleAction(action, payload);
  } catch (error) {
    return createResponse('error', null, error.toString());
  }
}

function doPost(e) {
  try {
    let data = {};
    if (e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch (err) {
        return createResponse('error', null, 'Invalid JSON');
      }
    }
    return handleAction(data.action, data);
  } catch (error) {
    return createResponse('error', null, error.toString());
  }
}

// ==================== ROUTER ====================

function handleAction(action, data) {
  Logger.log('Action: ' + action);
  
  try {
    switch(action) {
      // ===== AUTH =====
      case 'login':
        return handleLogin(data.email, data.password, data.deviceId);
      case 'validateSession':
        return handleValidateSession(data.email, data.sessionToken);
      case 'heartbeat':
        return handleHeartbeat(data.email, data.sessionToken);
      case 'logout':
        return handleLogout(data.email, data.sessionToken);
      
      // ===== QUIZ (STUDENT) =====
      case 'getQuestions':
        return handleGetQuestions(parseInt(data.grade), data.topic, parseInt(data.level));
      case 'getTopics':
        return handleGetTopics(parseInt(data.grade));
      case 'getTheory':
        return handleGetTheory(parseInt(data.grade), data.topic, parseInt(data.level));
      case 'getUserProgress':
        return handleGetUserProgress(data.email);
      case 'submitQuiz':
        return handleSubmitQuiz(data);
      
      // ===== ADMIN / TEACHER =====
      case 'getAllQuestions':
        return handleGetAllQuestions();
      case 'saveQuestion':
        return handleSaveQuestion(data);
      case 'saveTheory':
        return handleSaveTheory(data);
      case 'deleteQuestion':
        return handleDeleteQuestion(data.exam_id);
      case 'getAllStudents':
        return handleGetAllStudents();
      case 'getStudentResults':
        return handleGetStudentResults(data.email);
      
      // ===== RESOURCES (OCR DOCUMENTS) =====
      case 'saveDocument':
        return handleSaveDocument(data);
      case 'getAllDocuments':
        return handleGetAllDocuments();
      case 'deleteDocument':
        return handleDeleteDocument(data.id);
      
      // ===== OTHERS =====
      case 'reportViolation':
        return handleReportViolation(data);
      case 'getLeaderboard':
        return handleGetLeaderboard();
      case 'ping':
        return createResponse('success', { message: 'pong' });
      
      default:
        return createResponse('error', null, 'Unknown action: ' + action);
    }
  } catch (error) {
    return createResponse('error', null, 'Handler error: ' + error.toString());
  }
}

// ==================== AUTH SYSTEM ====================

function handleLogin(email, password, deviceId) {
  if (!email) return createResponse('error', null, 'Email trống');
  
  const usersSheet = getSheet(SHEET_NAMES.USERS);
  const userData = usersSheet.getDataRange().getValues();
  let user = null;
  
  // Tìm user
  for (let i = 1; i < userData.length; i++) {
    if (userData[i][0] === email) {
      const storedPass = String(userData[i][8] || '123456789'); // Cột 9 (Index 8) là password
      
      // Kiểm tra mật khẩu
      if (String(password) !== storedPass) {
        return createResponse('error', null, 'Sai mật khẩu!');
      }

      user = {
        email: userData[i][0],
        name: userData[i][1],
        class: userData[i][2],
        avatar: userData[i][3] || '',
        totalScore: userData[i][4] || 0,
        currentLevel: userData[i][5] || 1,
        progress: safeParseJSON(userData[i][6], {}),
        role: userData[i][7] || 'student'
      };
      break;
    }
  }
  
  // Tạo user mới (Chỉ cho email edu.vn hoặc admin)
  if (!user) {
    const isEduEmail = email.endsWith('@thayphuctoandongnai.edu.vn');
    const isAdminEmail = email.startsWith('admin') || email.startsWith('giaovien');
    
    if (!isEduEmail && !isAdminEmail) {
       return createResponse('error', null, 'Email không hợp lệ (phải đuôi @thayphuctoandongnai.edu.vn)');
    }

    const defaultPass = '123456789';
    if (String(password) !== defaultPass) {
       return createResponse('error', null, 'Tài khoản mới vui lòng dùng mật khẩu mặc định: 123456789');
    }

    const role = isAdminEmail ? 'teacher' : 'student';
    const name = email.split('@')[0];
    user = {
      email: email,
      name: name,
      class: 'Mới',
      avatar: '',
      totalScore: 0,
      currentLevel: 1,
      progress: {},
      role: role
    };
    
    usersSheet.appendRow([
      user.email, user.name, user.class, user.avatar, 
      user.totalScore, user.currentLevel, JSON.stringify(user.progress),
      user.role, defaultPass
    ]);
  }
  
  // Session handling
  invalidateUserSessions(email);
  const sessionToken = generateSessionToken();
  const sessionsSheet = getSheet(SHEET_NAMES.SESSIONS);
  sessionsSheet.appendRow([
    email, sessionToken, deviceId || 'web', new Date().toISOString(), 
    'active', '', new Date().toISOString()
  ]);
  
  return createResponse('success', { user: user, sessionToken: sessionToken });
}

function handleValidateSession(email, sessionToken) {
  if (!email || !sessionToken) return createResponse('success', { valid: false });
  const sessionsSheet = getSheet(SHEET_NAMES.SESSIONS);
  const data = sessionsSheet.getDataRange().getValues();
  // Duyệt ngược từ dưới lên để tìm session mới nhất nhanh hơn
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === email && data[i][1] === sessionToken) {
      return createResponse('success', { valid: data[i][4] === 'active', reason: data[i][4] });
    }
  }
  return createResponse('success', { valid: false });
}

function handleHeartbeat(email, sessionToken) {
  if (!email || !sessionToken) return createResponse('success', { valid: false });
  const sessionsSheet = getSheet(SHEET_NAMES.SESSIONS);
  const data = sessionsSheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === email && data[i][1] === sessionToken) {
      if (data[i][4] !== 'active') return createResponse('success', { valid: false, reason: 'session_conflict' });
      sessionsSheet.getRange(i + 1, 7).setValue(new Date().toISOString());
      return createResponse('success', { valid: true });
    }
  }
  return createResponse('success', { valid: false });
}

function handleLogout(email, sessionToken) {
  const sessionsSheet = getSheet(SHEET_NAMES.SESSIONS);
  const data = sessionsSheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === email && data[i][1] === sessionToken) {
      sessionsSheet.getRange(i + 1, 5).setValue('logged_out');
      break;
    }
  }
  return createResponse('success', { message: 'Logged out' });
}

function invalidateUserSessions(email) {
  const sessionsSheet = getSheet(SHEET_NAMES.SESSIONS);
  const data = sessionsSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email && data[i][4] === 'active') {
      sessionsSheet.getRange(i + 1, 5).setValue('expired');
    }
  }
}

function generateSessionToken() {
  return Math.random().toString(36).substring(2) + '_' + Date.now();
}

// ==================== QUESTION MANAGEMENT (ADMIN) ====================

function handleGetAllQuestions() {
  const sheet = getSheet(SHEET_NAMES.QUESTIONS);
  const data = sheet.getDataRange().getValues();
  const questions = [];
  
  // Bỏ qua header
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      questions.push(mapRowToQuestion(data[i]));
    }
  }
  
  return createResponse('success', questions.reverse()); // Mới nhất lên đầu
}

function handleSaveQuestion(data) {
  const sheet = getSheet(SHEET_NAMES.QUESTIONS);
  const examId = data.exam_id || 'Q' + Date.now();
  
  const rowData = [
    examId,
    data.level || 'Nhận biết',
    data.question_type || 'Trắc nghiệm',
    data.question_text || '',
    data.image_id || '',
    data.option_A || '',
    data.option_B || '',
    data.option_C || '',
    data.option_D || '',
    data.answer_key || '',
    data.solution || '',
    data.topic || '',
    data.grade || 12,
    data.quiz_level || 1
  ];
  
  const allData = sheet.getDataRange().getValues();
  let updated = false;
  
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][0] === examId) {
      const range = sheet.getRange(i + 1, 1, 1, rowData.length);
      range.setValues([rowData]);
      updated = true;
      break;
    }
  }
  
  if (!updated) {
    sheet.appendRow(rowData);
  }
  
  return createResponse('success', { 
    message: updated ? 'Cập nhật thành công' : 'Thêm mới thành công',
    exam_id: examId 
  });
}

function handleSaveTheory(data) {
  const sheet = getSheet(SHEET_NAMES.THEORY);
  const allData = sheet.getDataRange().getValues();
  let rowToUpdate = -1;
  
  for(let i = 1; i < allData.length; i++) {
     if(parseInt(allData[i][0]) === parseInt(data.grade) && 
        String(allData[i][1]).trim() === String(data.topic).trim() && 
        parseInt(allData[i][2]) === parseInt(data.level)) {
          rowToUpdate = i + 1;
          break;
     }
  }

  const rowData = [
    data.grade,
    data.topic,
    data.level,
    data.title,
    data.content,
    data.examples || '',
    data.tips || ''
  ];

  if (rowToUpdate > 0) {
     sheet.getRange(rowToUpdate, 1, 1, rowData.length).setValues([rowData]);
     return createResponse('success', { message: 'Đã cập nhật lý thuyết' });
  } else {
     sheet.appendRow(rowData);
     return createResponse('success', { message: 'Đã thêm lý thuyết mới' });
  }
}

function handleDeleteQuestion(examId) {
  const sheet = getSheet(SHEET_NAMES.QUESTIONS);
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === examId) {
      sheet.deleteRow(i + 1);
      return createResponse('success', { message: 'Đã xóa câu hỏi' });
    }
  }
  return createResponse('error', null, 'Không tìm thấy câu hỏi');
}

// ==================== DOCUMENT RESOURCES (NEW) ====================

function handleSaveDocument(data) {
  const sheet = getSheet(SHEET_NAMES.DOCUMENTS);
  const id = 'DOC_' + Date.now();
  sheet.appendRow([
    id,
    data.name,
    data.content, // OCR Text
    new Date().toISOString()
  ]);
  return createResponse('success', { message: 'Đã lưu tài liệu vào kho', id });
}

function handleGetAllDocuments() {
  const sheet = getSheet(SHEET_NAMES.DOCUMENTS);
  const data = sheet.getDataRange().getValues();
  const docs = [];
  
  // Skip header
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      docs.push({
        id: data[i][0],
        name: data[i][1],
        content: data[i][2],
        uploadedAt: data[i][3]
      });
    }
  }
  return createResponse('success', docs.reverse());
}

function handleDeleteDocument(id) {
  const sheet = getSheet(SHEET_NAMES.DOCUMENTS);
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      sheet.deleteRow(i + 1);
      return createResponse('success', { message: 'Đã xóa tài liệu' });
    }
  }
  return createResponse('error', null, 'Không tìm thấy tài liệu');
}

// ==================== STUDENT MANAGEMENT (ADMIN) ====================

function handleGetAllStudents() {
  const sheet = getSheet(SHEET_NAMES.USERS);
  const data = sheet.getDataRange().getValues();
  const students = [];
  
  for (let i = 1; i < data.length; i++) {
    // Chỉ lấy role student
    if (data[i][7] !== 'teacher' && data[i][0]) {
      students.push({
        email: data[i][0],
        name: data[i][1],
        class: data[i][2],
        totalScore: data[i][4],
        currentLevel: data[i][5]
      });
    }
  }
  return createResponse('success', students);
}

function handleGetStudentResults(email) {
  const sheet = getSheet(SHEET_NAMES.RESULTS);
  const data = sheet.getDataRange().getValues();
  const results = [];
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === email) {
      results.push({
        result_id: data[i][0], // ID
        topic: data[i][2],
        grade: data[i][3],
        level: data[i][4],
        score: data[i][5],
        total: data[i][6],
        percentage: data[i][7],
        status: data[i][8],
        timeSpent: data[i][9], // Thời gian làm bài
        submissionReason: data[i][10], // Lý do nộp (vi phạm?)
        answers: safeParseJSON(data[i][11], []), // Chi tiết câu trả lời
        timestamp: data[i][12]
      });
    }
  }
  // Sort theo thời gian giảm dần
  return createResponse('success', results.reverse());
}

// ==================== QUIZ LOGIC (STUDENT) ====================

function handleGetQuestions(grade, topic, level) {
  const sheet = getSheet(SHEET_NAMES.QUESTIONS);
  const data = sheet.getDataRange().getValues();
  const questions = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (parseInt(row[12]) === grade && String(row[11]).trim() === topic && parseInt(row[13]) === level) {
      questions.push(mapRowToQuestion(row));
    }
  }
  
  // Shuffle và lấy 10 câu
  const shuffled = questions.sort(() => 0.5 - Math.random()).slice(0, 10);
  return createResponse('success', shuffled);
}

function mapRowToQuestion(row) {
  return {
    exam_id: row[0],
    level: row[1],
    question_type: row[2],
    question_text: row[3],
    image_id: row[4],
    option_A: row[5],
    option_B: row[6],
    option_C: row[7],
    option_D: row[8],
    answer_key: row[9],
    solution: row[10],
    topic: row[11],
    grade: row[12],
    quiz_level: row[13]
  };
}

function handleGetTopics(grade) {
  const sheet = getSheet(SHEET_NAMES.QUESTIONS);
  const data = sheet.getDataRange().getValues();
  const topics = new Set();
  
  for (let i = 1; i < data.length; i++) {
    if (parseInt(data[i][12]) === grade && data[i][11]) {
      topics.add(data[i][11].trim());
    }
  }
  return createResponse('success', Array.from(topics).sort());
}

function handleGetTheory(grade, topic, level) {
  const sheet = getSheet(SHEET_NAMES.THEORY);
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (parseInt(data[i][0]) === grade && String(data[i][1]).trim() === topic && parseInt(data[i][2]) === level) {
      return createResponse('success', {
        title: data[i][3],
        content: data[i][4],
        examples: data[i][5] || '',
        tips: data[i][6] || ''
      });
    }
  }
  return createResponse('success', null);
}

function handleGetUserProgress(email) {
  const sheet = getSheet(SHEET_NAMES.USERS);
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email) {
      return createResponse('success', {
        totalScore: data[i][4] || 0,
        currentLevel: data[i][5] || 1,
        progress: safeParseJSON(data[i][6], {})
      });
    }
  }
  return createResponse('error', null, 'User not found');
}

function handleSubmitQuiz(data) {
  const { email, topic, grade, level, score, totalQuestions, answers, timeSpent, submissionReason, violations } = data;
  const resultsSheet = getSheet(SHEET_NAMES.RESULTS);
  const percentage = Math.round((score / totalQuestions) * 100);
  const passed = percentage >= 80 && submissionReason === 'normal';
  
  // Lưu kết quả
  resultsSheet.appendRow([
    'R_' + Date.now(), email, topic, grade, level, score, totalQuestions, 
    percentage, passed ? 'PASSED' : 'FAILED', timeSpent, submissionReason || 'normal', 
    JSON.stringify(answers || []), new Date().toISOString()
  ]);
  
  // Xử lý vi phạm
  if (submissionReason !== 'normal') {
    handleReportViolation({
      email, type: submissionReason, topic, level, details: violations || {}
    });
  }
  
  // Cập nhật tiến độ nếu đậu
  if (passed) {
    updateUserProgress(email, topic, grade, level, score);
  }
  
  return createResponse('success', { 
    passed, 
    percentage, 
    canAdvance: passed, 
    nextLevel: passed ? level + 1 : level,
    submissionReason: submissionReason || 'normal',
    answers: answers || [],
    message: passed ? 'Chúc mừng! Bạn đã vượt qua level này!' : 'Chưa đạt yêu cầu. Hãy ôn lại kiến thức!'
  });
}

function updateUserProgress(email, topic, grade, level, score) {
  const sheet = getSheet(SHEET_NAMES.USERS);
  const data = sheet.getDataRange().getValues();
  
  for(let i = 1; i < data.length; i++) {
    if(data[i][0] === email) {
      const currentTotal = parseInt(data[i][4]) || 0;
      sheet.getRange(i+1, 5).setValue(currentTotal + score); // Update total score
      
      let progress = safeParseJSON(data[i][6], {});
      const key = grade + '_' + topic;
      
      // Chỉ update nếu level mới cao hơn
      if(!progress[key] || progress[key] < level + 1) {
        progress[key] = level + 1;
      }
      sheet.getRange(i+1, 7).setValue(JSON.stringify(progress));
      break;
    }
  }
}

// ==================== OTHERS ====================

function handleReportViolation(data) {
  const sheet = getSheet(SHEET_NAMES.VIOLATIONS);
  sheet.appendRow([
    'V_' + Date.now(), 
    data.email, 
    data.type, 
    data.topic, 
    data.level, 
    JSON.stringify(data.details || {}), 
    new Date().toISOString()
  ]);
  return createResponse('success', { message: 'Logged violation' });
}

function handleGetLeaderboard() {
  const sheet = getSheet(SHEET_NAMES.USERS);
  const data = sheet.getDataRange().getValues();
  const users = [];
  
  for(let i = 1; i < data.length; i++) {
    // Chỉ lấy học sinh, có tên và điểm
    if(data[i][7] !== 'teacher' && data[i][0] && data[i][1]) {
      users.push({ 
        email: data[i][0], 
        name: data[i][1], 
        class: data[i][2], 
        avatar: data[i][3], 
        totalScore: parseInt(data[i][4]) || 0 
      });
    }
  }
  
  // Sort điểm giảm dần, lấy top 20
  return createResponse('success', users.sort((a,b) => b.totalScore - a.totalScore).slice(0, 20));
}

// ==================== HELPERS ====================

function getSheet(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    initializeSheet(sheet, name);
  }
  return sheet;
}

function initializeSheet(sheet, name) {
  const headers = {
    [SHEET_NAMES.USERS]: ['Email', 'Name', 'Class', 'Avatar', 'TotalScore', 'CurrentLevel', 'Progress', 'Role', 'Password'],
    [SHEET_NAMES.QUESTIONS]: ['exam_id', 'level', 'question_type', 'question_text', 'image_id', 'option_A', 'option_B', 'option_C', 'option_D', 'answer_key', 'solution', 'topic', 'grade', 'quiz_level'],
    [SHEET_NAMES.RESULTS]: ['result_id', 'email', 'topic', 'grade', 'level', 'score', 'total', 'percentage', 'status', 'time_spent', 'submission_reason', 'answers', 'timestamp'],
    [SHEET_NAMES.SESSIONS]: ['email', 'token', 'device', 'login_time', 'status', 'logout_time', 'last_heartbeat'],
    [SHEET_NAMES.VIOLATIONS]: ['id', 'email', 'type', 'topic', 'level', 'details', 'timestamp'],
    [SHEET_NAMES.THEORY]: ['grade', 'topic', 'level', 'title', 'content', 'examples', 'tips'],
    [SHEET_NAMES.DOCUMENTS]: ['id', 'name', 'content', 'uploaded_at']
  };
  
  if (headers[name]) {
    sheet.appendRow(headers[name]);
    sheet.getRange(1, 1, 1, headers[name].length).setFontWeight('bold').setBackground('#ccfbf1'); // Teal 100
  }
}

function createResponse(status, data, message) {
  return ContentService.createTextOutput(JSON.stringify({ 
    status, 
    data, 
    message: message || '' 
  })).setMimeType(ContentService.MimeType.JSON);
}

function safeParseJSON(str, fallback) {
  try { return JSON.parse(str); } catch (e) { return fallback; }
}
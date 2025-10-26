const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors({
  origin: ['https://college-gate-pass.vercel.app', 'http://localhost:3000'],
  credentials: true
}));
app.use(bodyParser.json());
app.use(express.static('public'));

// Database file path
const DB_FILE = path.join(__dirname, 'database.json');

// Helper function to read database
function readDatabase() {
  const data = fs.readFileSync(DB_FILE, 'utf8');
  return JSON.parse(data);
}

// Helper function to write to database
function writeDatabase(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Generate unique ID
function generateId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

// ===== AUTHENTICATION APIS =====

// Login API
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const db = readDatabase();
  
  const user = db.users.find(u => u.username === username && u.password === password);
  
  if (user) {
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        name: user.name
      }
    });
  } else {
    res.status(401).json({
      success: false,
      message: 'Invalid username or password'
    });
  }
});

// ===== STUDENT APIS =====

// Create gate pass request
app.post('/api/passes', (req, res) => {
  const { studentId, studentName, reason, destination, expectedReturn } = req.body;
  const db = readDatabase();
  
  const newPass = {
    id: generateId(),
    studentId,
    studentName,
    reason,
    destination,
    expectedReturn,
    status: 'pending',
    requestedAt: new Date().toISOString(),
    moderatorRemarks: '',
    approvedBy: null,
    exitTime: null,
    entryTime: null
  };
  
  db.passes.push(newPass);
  writeDatabase(db);
  
  res.json({
    success: true,
    pass: newPass
  });
});

// Get student's passes
app.get('/api/passes/student/:studentId', (req, res) => {
  const { studentId } = req.params;
  const db = readDatabase();
  
  const studentPasses = db.passes.filter(p => p.studentId === studentId);
  
  res.json({
    success: true,
    passes: studentPasses
  });
});

// ===== MODERATOR APIS =====

// Get all pending passes
app.get('/api/passes/pending', (req, res) => {
  const db = readDatabase();
  const pendingPasses = db.passes.filter(p => p.status === 'pending');
  
  res.json({
    success: true,
    passes: pendingPasses
  });
});

// Get all passes (for moderator)
app.get('/api/passes/all', (req, res) => {
  const db = readDatabase();
  
  res.json({
    success: true,
    passes: db.passes
  });
});

// Approve or reject pass
app.put('/api/passes/:passId/status', (req, res) => {
  const { passId } = req.params;
  const { status, remarks, moderatorName } = req.body;
  const db = readDatabase();
  
  const passIndex = db.passes.findIndex(p => p.id === passId);
  
  if (passIndex === -1) {
    return res.status(404).json({
      success: false,
      message: 'Pass not found'
    });
  }
  
  db.passes[passIndex].status = status;
  db.passes[passIndex].moderatorRemarks = remarks || '';
  db.passes[passIndex].approvedBy = moderatorName;
  db.passes[passIndex].approvedAt = new Date().toISOString();
  
  writeDatabase(db);
  
  res.json({
    success: true,
    pass: db.passes[passIndex]
  });
});

// ===== GATEKEEPER APIS =====

// Get pass by ID (for scanning)
app.get('/api/passes/:passId', (req, res) => {
  const { passId } = req.params;
  const db = readDatabase();
  
  const pass = db.passes.find(p => p.id === passId);
  
  if (!pass) {
    return res.status(404).json({
      success: false,
      message: 'Pass not found'
    });
  }
  
  res.json({
    success: true,
    pass
  });
});

// Mark exit
app.put('/api/passes/:passId/exit', (req, res) => {
  const { passId } = req.params;
  const db = readDatabase();
  
  const passIndex = db.passes.findIndex(p => p.id === passId);
  
  if (passIndex === -1) {
    return res.status(404).json({
      success: false,
      message: 'Pass not found'
    });
  }
  
  if (db.passes[passIndex].status !== 'approved') {
    return res.status(400).json({
      success: false,
      message: 'Pass is not approved'
    });
  }
  
  db.passes[passIndex].exitTime = new Date().toISOString();
  writeDatabase(db);
  
  res.json({
    success: true,
    pass: db.passes[passIndex]
  });
});

// Mark entry
app.put('/api/passes/:passId/entry', (req, res) => {
  const { passId } = req.params;
  const db = readDatabase();
  
  const passIndex = db.passes.findIndex(p => p.id === passId);
  
  if (passIndex === -1) {
    return res.status(404).json({
      success: false,
      message: 'Pass not found'
    });
  }
  
  if (!db.passes[passIndex].exitTime) {
    return res.status(400).json({
      success: false,
      message: 'Student has not exited yet'
    });
  }
  
  db.passes[passIndex].entryTime = new Date().toISOString();
  writeDatabase(db);
  
  res.json({
    success: true,
    pass: db.passes[passIndex]
  });
});

// Get active passes (approved but not completed)
app.get('/api/passes/active', (req, res) => {
  const db = readDatabase();
  const activePasses = db.passes.filter(p => 
    p.status === 'approved' && !p.entryTime
  );
  
  res.json({
    success: true,
    passes: activePasses
  });
});
// ===== LOCATION TRACKING APIS =====

// Update student location (only if late)
app.post('/api/passes/:passId/location', (req, res) => {
  const { passId } = req.params;
  const { latitude, longitude, timestamp } = req.body;
  const db = readDatabase();
  
  const passIndex = db.passes.findIndex(p => p.id === passId);
  
  if (passIndex === -1) {
    return res.status(404).json({
      success: false,
      message: 'Pass not found'
    });
  }
  
  const pass = db.passes[passIndex];
  
  // Only track if student is late
  const expectedReturn = new Date(pass.expectedReturn);
  const now = new Date();
  
  if (now > expectedReturn && pass.exitTime && !pass.entryTime) {
    db.passes[passIndex].location = {
      latitude,
      longitude,
      timestamp,
      isLate: true
    };
    
    writeDatabase(db);
    
    return res.json({
      success: true,
      message: 'Location tracked',
      pass: db.passes[passIndex]
    });
  } else {
    return res.json({
      success: false,
      message: 'Not late, location not tracked'
    });
  }
});

// Get late students
app.get('/api/passes/late', (req, res) => {
  const db = readDatabase();
  const now = new Date();
  
  const latePasses = db.passes.filter(p => {
    const expectedReturn = new Date(p.expectedReturn);
    return (
      p.status === 'approved' &&
      p.exitTime &&
      !p.entryTime &&
      now > expectedReturn
    );
  });
  
  res.json({
    success: true,
    passes: latePasses
  });
});
// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`📁 Database file: ${DB_FILE}`);
});

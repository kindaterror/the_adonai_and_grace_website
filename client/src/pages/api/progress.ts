// == IMPORTS & DEPENDENCIES ==
import jwt from 'jsonwebtoken';
import { db } from "@db";
import * as schema from "@shared/schema";
import { eq, and } from "drizzle-orm";

// == CONSTANTS ==
const JWT_SECRET = process.env.JWT_SECRET || "adonai_grace_school_secret";

// == TYPE DEFINITIONS ==
interface JWTPayload {
  userId: number;
  role: string;
  username: string;
  iat?: number;
  exp?: number;
}

// == MAIN API HANDLER ==
export default async function handler(req: any, res: any) {
  console.log(`🔍 API endpoint /api/progress called with method: ${req.method}`);
  
  // == METHOD ROUTING ==
  if (req.method === 'GET') {
    return handleGetProgress(req, res);
  } 
  
  if (req.method === 'POST') {
    return handlePostProgress(req, res);
  }
  
  return res.status(405).json({ message: 'Method not allowed' });
}

// == GET PROGRESS HANDLER ==
async function handleGetProgress(req: any, res: any) {
  
  // == AUTHENTICATION ==
  let token: string | undefined;
  try { token = String(req.headers.authorization || "").split(' ')[1]; } catch { token = undefined; }
  if (!token) {
    console.log("❌ No token provided");
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    // == TOKEN VERIFICATION ==
  const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
  console.log("✅ Decoded token: userId=" + decoded.userId + ", role=" + decoded.role);
    
    // == AUTHORIZATION CHECK ==
    if (!decoded || (decoded.role !== 'teacher' && decoded.role !== 'admin')) {
      console.log("❌ Access denied for role:", decoded.role);
      return res.status(403).json({ message: 'Access denied' });
    }
    
  console.log("🔍 Starting database query for progress...");
    
    // == FETCH PROGRESS DATA ==
    const progress = await db.query.progress.findMany({
      with: {
        book: {
          columns: {
            id: true,
            title: true,
            description: true,
            type: true,
            grade: true,
            coverImage: true
          }
        },
        user: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            username: true,
            gradeLevel: true
          }
        }
      },
      orderBy: (progress, { desc }) => [desc(progress.lastReadAt)]
    });
    
  console.log("✅ Database query completed. Records:", progress.length);
    
    // == DEBUG LOGGING ==
    if (progress.length > 0) {
      console.log("📝 Returning progress sample metadata: id=" + String(progress[0].id));
    } else {
      console.log("⚠️ No progress records found in database");
    }
    
    // == SUCCESS RESPONSE ==
    return res.status(200).json({ 
      success: true,
      progress: progress || [],
      totalProgress: progress?.length || 0
    });
    
  } catch (error) {
    // == ERROR HANDLING ==
    console.error('❌ Error in /api/progress GET endpoint:');
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// == POST PROGRESS HANDLER ==
async function handlePostProgress(req: any, res: any) {
  // Avoid logging full request body
  console.log("📝 Saving progress update (sanitized)");
  
  let token: string | undefined;
  try { token = String(req.headers.authorization || "").split(' ')[1]; } catch { token = undefined; }
  if (!token) {
    console.log("❌ No token provided for POST");
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    // == TOKEN VERIFICATION ==
  const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
  console.log("✅ POST - Decoded token: userId=" + decoded.userId + ", role=" + decoded.role);
    
    // == AUTHORIZATION CHECK ==
    if (!decoded || (decoded.role !== 'student' && decoded.role !== 'teacher' && decoded.role !== 'admin')) {
      console.log("❌ Access denied for role:", decoded.role);
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // == INPUT VALIDATION ==
    const { bookId, percentComplete } = req.body;
    
    if (bookId == null || percentComplete === undefined || !Number.isFinite(Number(bookId))) {
      return res.status(400).json({ message: 'Missing or invalid bookId or percentComplete' });
    }

    const pct = Math.min(100, Math.max(0, Number(percentComplete)));
    console.log(`📊 Updating progress for user ${decoded.userId}, book ${bookId}, progress ${pct}%`);
    
    // == CHECK EXISTING PROGRESS ==
    const existingProgress = await db.query.progress.findFirst({
      where: and(
        eq(schema.progress.userId, decoded.userId),
        eq(schema.progress.bookId, bookId)
      )
    });

    if (existingProgress) {
      // == UPDATE EXISTING PROGRESS ==
  console.log("🔄 Updating existing progress record: id=" + String(existingProgress.id));
      await db.update(schema.progress)
        .set({
          percentComplete,
          lastReadAt: new Date()
        })
        .where(eq(schema.progress.id, existingProgress.id));
    } else {
      // == CREATE NEW PROGRESS ==
  console.log("➕ Creating new progress record");
      await db.insert(schema.progress).values({
        userId: decoded.userId,
        bookId,
        percentComplete,
        totalReadingTime: 0, // Initialize with 0, will be updated by reading sessions
        lastReadAt: new Date()
      });
    }

    // == SUCCESS RESPONSE ==
    console.log("✅ Progress saved successfully");
    return res.status(200).json({ success: true, message: 'Progress updated successfully', data: { userId: decoded.userId, bookId, percentComplete: pct } });
    
  } catch (error) {
    // == ERROR HANDLING ==
    console.error("❌ Error saving progress:");
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}
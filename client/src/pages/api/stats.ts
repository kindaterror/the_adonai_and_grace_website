// == IMPORTS & DEPENDENCIES ==
import { Request, Response } from 'express';
import { db } from '@db';
import * as schema from '@shared/schema';
import { isNotNull, eq } from 'drizzle-orm';

// == MAIN API HANDLER ==
export default async function handler(req: Request, res: Response) {
  
  // == METHOD VALIDATION ==
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    console.log("=== FETCHING DASHBOARD STATS ===");
    
    // == FETCH READING SESSIONS ==
    const allSessions = await db.select()
      .from(schema.readingSessions)
      .where(isNotNull(schema.readingSessions.endTime));
    
    // == CALCULATE AVERAGE READING TIME ==
    const completedSessions = allSessions.filter(session => 
      session.totalMinutes && session.totalMinutes > 0
    );
    
    const avgReadingTime = completedSessions.length > 0 
      ? Math.round(
          completedSessions.reduce((sum, session) => sum + (session.totalMinutes || 0), 0) 
          / completedSessions.length
        )
      : 25; // fallback to 25 minutes
    
    // == FETCH PROGRESS DATA ==
    const allProgress = await db.select({
      id: schema.progress.id,
      userId: schema.progress.userId,
      bookId: schema.progress.bookId,
      percentComplete: schema.progress.percentComplete,
      userFirstName: schema.users.firstName,
      userLastName: schema.users.lastName,
      bookTitle: schema.books.title
    })
    .from(schema.progress)
    .leftJoin(schema.users, eq(schema.progress.userId, schema.users.id))
    .leftJoin(schema.books, eq(schema.progress.bookId, schema.books.id));
    
    console.log("📊 Total progress records found:", allProgress.length);
    
    // == FILTER COMPLETED BOOKS ==
    // Completed books (do not log per-user details to avoid leaking PII)
    const completedBooks = allProgress.filter((p) => (p.percentComplete || 0) >= 100);
    
    // == CALCULATE COMPLETION RATES ==
    const allUserIds = allProgress.map(p => p.userId);
    const completedUserIds = completedBooks.map(p => p.userId);
    const uniqueUsers = Array.from(new Set(allUserIds));
    const usersWithCompletedBooks = Array.from(new Set(completedUserIds));
    
    const completionRate = uniqueUsers.length > 0 
      ? Math.round((usersWithCompletedBooks.length / uniqueUsers.length) * 100)
      : 0;
    
    const bookCompletionRate = allProgress.length > 0 
      ? Math.round((completedBooks.length / allProgress.length) * 100)
      : 0;
    
    // == BUILD STATS OBJECT ==
    const stats = {
      avgReadingTime: avgReadingTime,
      completionRate: completionRate, // User-based completion rate
      totalSessions: allSessions.length,
      totalReadingMinutes: completedSessions.reduce((sum, session) => 
        sum + (session.totalMinutes || 0), 0
      ),
      debug: {
        totalProgressRecords: allProgress.length,
        completedBooksCount: completedBooks.length,
        uniqueUsersCount: uniqueUsers.length,
        usersWithCompletedBooksCount: usersWithCompletedBooks.length,
        userBasedCompletionRate: completionRate,
        bookBasedCompletionRate: bookCompletionRate,
      }
    };
    
    // == DEBUG LOGGING ==
    console.log("=== DASHBOARD STATS CALCULATED ===");
  console.log(`📈 Completion Rate: ${completionRate}%`);
  console.log(`📚 Completed Books: ${completedBooks.length}`);
  console.log(`⏱️ Average Reading Time: ${avgReadingTime} minutes`);
    
    // == SUCCESS RESPONSE ==
    return res.status(200).json({
      success: true,
      stats: stats
    });
    
  } catch (error) {
    // == ERROR HANDLING ==
    console.error("Error fetching dashboard stats:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Internal server error" 
    });
  }
}
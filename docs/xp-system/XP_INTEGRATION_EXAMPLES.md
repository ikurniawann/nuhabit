# XP Integration Examples - TalentPool

Contoh implementasi XP system di API routes dan components yang sudah ada di TalentPool.

---

## 📍 Integration Points

### 1. Candidate Creation (Add XP: +25)

**File:** `src/app/api/candidates/route.ts`

```typescript
import { xpService, XP_RULES } from "@/lib/xp";
import { createClient } from "@/lib/pg/create-client";

export async function POST(req: Request) {
  const db = await createServerPgClient();
  
  // Get current user
  const { data: { user } } = await db.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    
    // Create candidate (existing logic)
    const { data: candidate, error } = await db
      .from('candidates')
      .insert({
        ...body,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) throw error;

    // 🎮 ADD XP for creating candidate
    const xpResult = await xpService.addXP(
      user.id,
      'candidate_added',
      `Candidate added: ${body.full_name}`,
      candidate.id,
      'candidate',
      { position: body.position_id, brand: body.brand_id, source: body.source }
    );

    return Response.json({
      success: true,
      candidate,
      xp: xpResult.success ? {
        earned: XP_RULES.candidate_added,
        newLevel: xpResult.newLevel,
        levelUp: xpResult.levelUp,
      } : null,
    });

  } catch (error) {
    console.error('Error creating candidate:', error);
    return Response.json({ error: "Failed to create candidate" }, { status: 500 });
  }
}
```

---

### 2. Candidate Status Update (Add XP: +10 for update, +100 for hired)

**File:** `src/app/api/candidates/[id]/route.ts`

```typescript
import { xpService, XP_RULES } from "@/lib/xp";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const db = await createServerPgClient();
  const { data: { user } } = await db.auth.getUser();
  
  try {
    const body = await req.json();
    const candidateId = params.id;

    // Get current candidate status
    const { data: currentCandidate } = await db
      .from('candidates')
      .select('status')
      .eq('id', candidateId)
      .single();

    // Update candidate (existing logic)
    const { data: updatedCandidate, error } = await db
      .from('candidates')
      .update({
        ...body,
        updated_at: new Date().toISOString(),
      })
      .eq('id', candidateId)
      .select()
      .single();

    if (error) throw error;

    // 🎮 ADD XP for updating candidate
    let xpResult = null;
    
    // Base XP for update
    if (body.status) {
      xpResult = await xpService.addXP(
        user.id,
        'candidate_updated',
        `Candidate status updated: ${currentCandidate.status} → ${body.status}`,
        candidateId,
        'candidate',
        { old_status: currentCandidate.status, new_status: body.status }
      );
    }

    // Bonus XP if hired!
    if (body.status === 'hired' && currentCandidate.status !== 'hired') {
      const hireXpResult = await xpService.addXP(
        user.id,
        'candidate_hired',
        `Candidate hired: ${updatedCandidate.full_name}`,
        candidateId,
        'hiring',
        { position: updatedCandidate.position_id, brand: updatedCandidate.brand_id }
      );

      // Merge XP results
      if (xpResult && hireXpResult.success) {
        xpResult.newLevel = hireXpResult.newLevel;
        xpResult.levelUp = hireXpResult.levelUp;
      }
    }

    return Response.json({
      success: true,
      candidate: updatedCandidate,
      xp: xpResult?.success ? {
        earned: XP_RULES.candidate_updated + (body.status === 'hired' ? XP_RULES.candidate_hired : 0),
        newLevel: xpResult.newLevel,
        levelUp: xpResult.levelUp,
      } : null,
    });

  } catch (error) {
    console.error('Error updating candidate:', error);
    return Response.json({ error: "Failed to update candidate" }, { status: 500 });
  }
}
```

---

### 3. Interview Completion (Add XP: +40 +15 for scorecard)

**File:** `src/app/api/interviews/route.ts` (or wherever interviews are completed)

```typescript
import { xpService, XP_RULES } from "@/lib/xp";

export async function POST(req: Request) {
  const db = await createServerPgClient();
  const { data: { user } } = await db.auth.getUser();
  
  try {
    const body = await req.json();

    // Create/complete interview (existing logic)
    const { data: interview, error } = await db
      .from('interviews')
      .insert({
        ...body,
        interviewer_id: user.id,
      })
      .select()
      .single();

    if (error) throw error;

    // 🎮 ADD XP for completing interview
    let totalXP = XP_RULES.interview_completed;
    let xpResult = await xpService.addXP(
      user.id,
      'interview_completed',
      `Interview completed for candidate`,
      interview.candidate_id,
      'interview',
      { interview_type: body.type }
    );

    // Bonus XP if scorecard filled
    if (body.scorecard && Object.keys(body.scorecard).length > 0) {
      await xpService.addXP(
        user.id,
        'interview_scorecard_filled',
        'Interview scorecard completed',
        interview.id,
        'interview',
        { scorecard: body.scorecard }
      );
      totalXP += XP_RULES.interview_scorecard_filled;
    }

    return Response.json({
      success: true,
      interview,
      xp: xpResult.success ? {
        earned: totalXP,
        newLevel: xpResult.newLevel,
        levelUp: xpResult.levelUp,
      } : null,
    });

  } catch (error) {
    console.error('Error creating interview:', error);
    return Response.json({ error: "Failed to create interview" }, { status: 500 });
  }
}
```

---

### 4. Daily Login Bonus (Add XP: +5)

**File:** `src/app/(dashboard)/dashboard/layout.tsx` or middleware

```typescript
"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/pg/browser-client";
import { xpService } from "@/lib/xp";
import { useUser } from "@/hooks/useUser";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const db = await createServerPgClient();

  useEffect(() => {
    if (!user) return;

    const checkDailyLogin = async () => {
      // Get user's last login
      const { data: stats } = await db
        .from('user_xp_stats')
        .select('last_login')
        .eq('user_id', user.id)
        .single();

      const today = new Date().toDateString();
      const lastLogin = stats?.last_login 
        ? new Date(stats.last_login).toDateString() 
        : null;

      // Award XP if first login today
      if (lastLogin !== today) {
        const xpResult = await xpService.addXP(
          user.id,
          'daily_login',
          'Daily login bonus',
          undefined,
          'engagement',
          { date: today }
        );

        if (xpResult.success && xpResult.levelUp) {
          // Show level up notification
          console.log('🎉 Level up!', xpResult.newLevel);
        }

        // Update last_login
        await db
          .from('user_xp_stats')
          .update({ last_login: today })
          .eq('user_id', user.id);
      }
    };

    checkDailyLogin();
  }, [user, db]);

  return (
    <div className="dashboard-layout">
      {/* XP Widget in Header */}
      <XPHeaderWidget userId={user?.id} />
      
      {children}
    </div>
  );
}
```

---

### 5. XP Stats Component Integration

**File:** `src/app/(dashboard)/dashboard/page.tsx`

```typescript
"use client";

import { XPStatsCard } from "@/components/xp/xp-stats-card";
import { XPActivityFeed } from "@/components/xp/xp-activity-feed";
import { XPLeaderboard } from "@/components/xp/xp-leaderboard";
import { xpService } from "@/lib/xp";
import { useState, useEffect } from "react";

export default function DashboardPage() {
  const { user } = useUser();
  const [xpStats, setXpStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fetchXPStats = async () => {
      const stats = await xpService.getUserStats(user.id);
      if (stats) {
        setXpStats(stats);
      }
      setLoading(false);
    };

    fetchXPStats();
  }, [user]);

  if (!xpStats) return <DashboardSkeleton />;

  return (
    <div className="p-6 space-y-6">
      {/* XP Section - NEW */}
      <section>
        <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
          <Trophy className="w-6 h-6 text-yellow-500" />
          Your Progress
        </h2>
        
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {/* Main XP Stats */}
          <div className="lg:col-span-2">
            <XPStatsCard
              currentXP={xpStats.current_xp}
              level={xpStats.level}
              xpToNextLevel={xpStats.xp_to_next_level}
              streakDays={xpStats.streak_days}
              totalBadges={xpStats.total_badges || 0}
            />
          </div>
          
          {/* Mini Leaderboard */}
          <div>
            <XPLeaderboard userId={user.id} limit={5} />
          </div>
        </div>
      </section>

      {/* Existing Dashboard Content */}
      <section>
        <h2 className="text-2xl font-bold mb-4">Recruitment Overview</h2>
        {/* ... existing stats cards ... */}
      </section>

      {/* XP Activity & Challenges */}
      <div className="grid gap-6 md:grid-cols-2">
        <XPActivityFeed userId={user.id} limit={10} />
        <XPChallengeCard userId={user.id} />
      </div>

      {/* ... rest of existing dashboard ... */}
    </div>
  );
}
```

---

### 6. XP Sidebar Widget (Always Visible)

**File:** `src/components/shared/dashboard-sidebar.tsx`

```typescript
import { XPService } from "@/lib/xp";
import { Flame, Trophy } from "lucide-react";

interface DashboardSidebarProps {
  userId: string;
}

export function DashboardSidebar({ userId }: DashboardSidebarProps) {
  const [xpStats, setXpStats] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      const stats = await xpService.getUserStats(userId);
      setXpStats(stats);
    };
    fetchStats();
  }, [userId]);

  return (
    <aside className="sidebar">
      {/* Existing sidebar content */}
      
      {/* XP Widget - NEW */}
      {xpStats && (
        <div className="mt-auto p-4 bg-gradient-to-br from-green-50 to-emerald-100 rounded-lg border border-green-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-green-800">
              Level {xpStats.level}
            </span>
            <div className="flex items-center gap-1 text-xs text-orange-700">
              <Flame className="w-3 h-3" />
              {xpStats.streak_days}
            </div>
          </div>
          
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-green-700">
              <span>{xpStats.current_xp} XP</span>
              <span>{xpStats.xp_to_next_level} XP</span>
            </div>
            <Progress 
              value={(xpStats.current_xp / xpStats.xp_to_next_level) * 100}
              className="h-1.5"
            />
          </div>
          
          <Link 
            href="/dashboard/xp"
            className="mt-3 text-xs text-green-700 hover:text-green-900 flex items-center gap-1"
          >
            View XP Dashboard <Trophy className="w-3 h-3" />
          </Link>
        </div>
      )}
    </aside>
  );
}
```

---

## 🎨 New XP Dashboard Page

**File:** `src/app/(dashboard)/dashboard/xp/page.tsx`

```typescript
"use client";

import { useUser } from "@/hooks/useUser";
import { xpService } from "@/lib/xp";
import { XPStatsCard } from "@/components/xp/xp-stats-card";
import { XPActivityFeed } from "@/components/xp/xp-activity-feed";
import { XPLeaderboard } from "@/components/xp/xp-leaderboard";
import { XPBadgeCollection } from "@/components/xp/xp-badge-collection";
import { XPChallengeCard } from "@/components/xp/xp-challenge-card";
import { XPRewardsStore } from "@/components/xp/xp-rewards-store";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trophy, Award, Target, Gift, Activity } from "lucide-react";
import { useState, useEffect } from "react";

export default function XPDashboardPage() {
  const { user } = useUser();
  const [xpStats, setXpStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fetchAllXPData = async () => {
      const [stats] = await Promise.all([
        xpService.getUserStats(user.id),
      ]);
      
      setXpStats(stats);
      setLoading(false);
    };

    fetchAllXPData();
  }, [user]);

  if (loading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Trophy className="w-8 h-8 text-yellow-500" />
            XP Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Track your progress, earn badges, and compete with your team
          </p>
        </div>
      </div>

      {/* Main Stats */}
      <XPStatsCard
        currentXP={xpStats.current_xp}
        level={xpStats.level}
        xpToNextLevel={xpStats.xp_to_next_level}
        streakDays={xpStats.streak_days}
        totalBadges={xpStats.total_badges || 0}
      />

      {/* Tabs for different sections */}
      <Tabs defaultValue="activity" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="activity" className="flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Activity
          </TabsTrigger>
          <TabsTrigger value="challenges" className="flex items-center gap-2">
            <Target className="w-4 h-4" />
            Challenges
          </TabsTrigger>
          <TabsTrigger value="badges" className="flex items-center gap-2">
            <Award className="w-4 h-4" />
            Badges
          </TabsTrigger>
          <TabsTrigger value="leaderboard" className="flex items-center gap-2">
            <Trophy className="w-4 h-4" />
            Leaderboard
          </TabsTrigger>
          <TabsTrigger value="rewards" className="flex items-center gap-2">
            <Gift className="w-4 h-4" />
            Rewards
          </TabsTrigger>
        </TabsList>

        <TabsContent value="activity">
          <XPActivityFeed userId={user.id} limit={50} />
        </TabsContent>

        <TabsContent value="challenges">
          <div className="grid gap-4 md:grid-cols-2">
            <XPChallengeCard userId={user.id} type="weekly" />
            <XPChallengeCard userId={user.id} type="monthly" />
          </div>
        </TabsContent>

        <TabsContent value="badges">
          <XPBadgeCollection userId={user.id} />
        </TabsContent>

        <TabsContent value="leaderboard">
          <XPLeaderboard userId={user.id} limit={20} />
        </TabsContent>

        <TabsContent value="rewards">
          <XPRewardsStore userId={user.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

---

## 📋 TypeScript Types

**File:** `src/types/xp.ts`

```typescript
export interface UserXPStats {
  user_id: string;
  current_xp: number;
  total_xp_earned: number;
  total_xp_spent: number;
  level: number;
  xp_to_next_level: number;
  streak_days: number;
  last_activity: string;
  last_login: string;
  created_at: string;
  updated_at: string;
}

export interface XPActivity {
  id: string;
  user_id: string;
  activity_type: string;
  xp_earned: number;
  description: string;
  reference_id: string | null;
  reference_type: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

export interface XPBadge {
  id: string;
  badge_name: string;
  badge_icon: string;
  badge_color: string;
  xp_requirement: number;
  criteria: Record<string, any>;
  description: string;
  category: 'recruiter' | 'interviewer' | 'closer' | 'engagement' | 'general';
  is_active: boolean;
}

export interface UserBadge {
  user_id: string;
  badge_id: string;
  unlocked_at: string;
  xp_badges: XPBadge;
}

export interface XPChallenge {
  id: string;
  challenge_name: string;
  challenge_type: 'daily' | 'weekly' | 'monthly' | 'one-time';
  activity_type: string;
  target_count: number;
  xp_reward: number;
  start_date: string;
  end_date: string;
  is_active: boolean;
  progress?: number;
  isCompleted?: boolean;
  xpClaimed?: boolean;
}

export interface XPReward {
  id: string;
  reward_name: string;
  reward_description: string | null;
  xp_cost: number;
  reward_type: 'voucher' | 'perk' | 'badge' | 'custom';
  reward_data: Record<string, any>;
  stock: number | null;
  image_url: string | null;
  is_active: boolean;
}

export interface XPRedemption {
  id: string;
  user_id: string;
  reward_id: string;
  xp_spent: number;
  status: 'pending' | 'fulfilled' | 'cancelled';
  redeemed_at: string;
  fulfilled_at: string | null;
  notes: string | null;
  xp_rewards: XPReward;
}

export type XPLevelTitle = 
  | 'Recruiter'
  | 'Senior Recruiter'
  | 'HR Manager'
  | 'HR Director'
  | 'VP of Talent';
```

---

## 🚀 Quick Start Checklist

### 1. Run Migration
```bash
cd /Users/ilham/Desktop/talentpool
# Apply migration to PostgreSQL
npm run db:migrate:apply --db-url "your-database-url"
# OR run SQL directly in database admin
```

### 2. Add Types
```bash
# Generate types from schema if needed
# generate types from schema manually typescript --project-id "your-project-id" > src/types/database.ts
```

### 3. Test XP Earning
```typescript
// Test in browser console or create test endpoint
import { xpService } from "@/lib/xp";

const result = await xpService.addXP(
  userId,
  'candidate_added',
  'Test candidate',
  'test-id',
  'candidate'
);

console.log(result); // { success: true, newXP: 25, newLevel: 1, levelUp: false }
```

### 4. Deploy
```bash
git add .
git commit -m "feat: add XP gamification system"
git push
# Vercel will auto-deploy
```

---

*Created: 2026-05-02*
*For: TalentPool XP Integration*

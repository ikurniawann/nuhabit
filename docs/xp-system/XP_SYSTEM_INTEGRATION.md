# XP System Integration - TalentPool

## 🎯 Overview
Gamifikasi dashboard TalentPool dengan sistem XP untuk meningkatkan engagement HRD/Recruiter dalam:
- Menambah candidates baru
- Melakukan interview
- Update status candidate
- Response time cepat
- Closing hire

---

## 📊 XP Activities untuk TalentPool

### XP Earning Rules
```typescript
const TALENTPOOL_XP_RULES = {
  // Candidate Management
  candidate_added: 25,           // +25 XP per candidate baru
  candidate_updated: 10,         // +10 XP update status/notes
  candidate_screening: 15,       // +15 XP screening CV
  
  // Interview Activities
  interview_scheduled: 20,       // +20 XP jadwal interview
  interview_completed: 40,       // +40 XP selesai interview
  interview_scorecard_filled: 15, // +15 XP isi scorecard
  
  // Hiring Success
  candidate_hired: 100,          // +100 XP candidate hired
  candidate_talent_pooled: 30,   // +30 XP masuk talent pool
  
  // Engagement
  daily_login: 5,                // +5 XP login harian
  fast_response: 20,             // +20 XP response <1 jam
  weekly_streak: 50,             // +50 XP 7 hari berturut-turut
  
  // Quality
  complete_profile: 25,          // +25 XP candidate profile 100%
  referral_hired: 150,           // +150 XP referral yang hired
};
```

---

## 🗄️ Database Migration

### File: `database/migrations/006_add_xp_system.sql`

```sql
-- ============================================================
-- XP System for TalentPool
-- ============================================================

-- User XP Stats
CREATE TABLE IF NOT EXISTS user_xp_stats (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  current_xp INTEGER NOT NULL DEFAULT 0,
  total_xp_earned INTEGER NOT NULL DEFAULT 0,
  total_xp_spent INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  xp_to_next_level INTEGER NOT NULL DEFAULT 1000,
  streak_days INTEGER NOT NULL DEFAULT 0,
  last_activity TIMESTAMPTZ,
  last_login DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- XP Activities Log
CREATE TABLE IF NOT EXISTS xp_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  xp_earned INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  reference_id UUID, -- candidate_id, interview_id, etc
  reference_type TEXT, -- 'candidate', 'interview', 'hiring'
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Badges
CREATE TABLE IF NOT EXISTS xp_badges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  badge_name TEXT NOT NULL UNIQUE,
  badge_icon TEXT NOT NULL,
  badge_color TEXT NOT NULL DEFAULT '#228B22',
  xp_requirement INTEGER NOT NULL DEFAULT 0,
  criteria JSONB NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general', -- 'recruiter', 'interviewer', 'closer'
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- User Badges (Unlocked)
CREATE TABLE IF NOT EXISTS user_badges (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_id UUID NOT NULL REFERENCES xp_badges(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, badge_id)
);

-- Weekly/Monthly Challenges
CREATE TABLE IF NOT EXISTS xp_challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenge_name TEXT NOT NULL,
  challenge_type TEXT NOT NULL CHECK (challenge_type IN ('daily', 'weekly', 'monthly', 'one-time')),
  activity_type TEXT NOT NULL,
  target_count INTEGER NOT NULL,
  xp_reward INTEGER NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User Challenge Progress
CREATE TABLE IF NOT EXISTS user_challenge_progress (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge_id UUID NOT NULL REFERENCES xp_challenges(id) ON DELETE CASCADE,
  current_progress INTEGER NOT NULL DEFAULT 0,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  xp_claimed BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, challenge_id)
);

-- Rewards Store
CREATE TABLE IF NOT EXISTS xp_rewards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reward_name TEXT NOT NULL,
  reward_description TEXT,
  xp_cost INTEGER NOT NULL,
  reward_type TEXT NOT NULL CHECK (reward_type IN ('voucher', 'perk', 'badge', 'custom')),
  reward_data JSONB, -- voucher code, perk details, etc
  stock INTEGER,
  image_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Redemptions
CREATE TABLE IF NOT EXISTS xp_redemptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reward_id UUID NOT NULL REFERENCES xp_rewards(id) ON DELETE CASCADE,
  xp_spent INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'fulfilled', 'cancelled')),
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fulfilled_at TIMESTAMPTZ,
  notes TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_xp_activities_user ON xp_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_xp_activities_created ON xp_activities(created_at);
CREATE INDEX IF NOT EXISTS idx_user_challenge_progress_user ON user_challenge_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_user_challenge_progress_challenge ON user_challenge_progress(challenge_id);
CREATE INDEX IF NOT EXISTS idx_xp_redemptions_user ON xp_redemptions(user_id);

-- Trigger: Auto-update user_xp_stats.updated_at
CREATE OR REPLACE FUNCTION update_xp_stats_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_xp_stats_timestamp
  BEFORE UPDATE ON user_xp_stats
  FOR EACH ROW
  EXECUTE FUNCTION update_xp_stats_timestamp();

-- Function: Add XP to user
CREATE OR REPLACE FUNCTION add_xp_to_user(
  p_user_id UUID,
  p_xp_amount INTEGER,
  p_activity_type TEXT,
  p_description TEXT,
  p_reference_id UUID DEFAULT NULL,
  p_reference_type TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  v_new_xp INTEGER;
  v_new_level INTEGER;
  v_xp_to_next INTEGER;
BEGIN
  -- Insert activity log
  INSERT INTO xp_activities (user_id, activity_type, xp_earned, description, reference_id, reference_type, metadata)
  VALUES (p_user_id, p_activity_type, p_xp_amount, p_description, p_reference_id, p_reference_type, p_metadata);
  
  -- Update user stats
  UPDATE user_xp_stats
  SET 
    current_xp = current_xp + p_xp_amount,
    total_xp_earned = total_xp_earned + p_xp_amount,
    last_activity = NOW()
  WHERE user_id = p_user_id
  RETURNING current_xp, level INTO v_new_xp, v_new_level;
  
  -- Calculate new level
  v_new_level := FLOOR(SQRT(v_new_xp / 1000.0)) + 1;
  v_xp_to_next := FLOOR(1000 * POWER(1.25, v_new_level));
  
  -- Update level if changed
  UPDATE user_xp_stats
  SET 
    level = v_new_level,
    xp_to_next_level = v_xp_to_next
  WHERE user_id = p_user_id AND level != v_new_level;
  
  RETURN v_new_xp;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Check and award badges
CREATE OR REPLACE FUNCTION check_badge_unlock(p_user_id UUID)
RETURNS TABLE(badge_id UUID, badge_name TEXT, xp_requirement INTEGER) AS $$
BEGIN
  RETURN QUERY
  SELECT b.id, b.badge_name, b.xp_requirement
  FROM xp_badges b
  LEFT JOIN user_badges ub ON b.id = ub.badge_id AND ub.user_id = p_user_id
  WHERE ub.user_id IS NULL  -- Not yet unlocked
    AND b.is_active = true
    AND (
      -- Check total XP requirement
      (SELECT total_xp_earned FROM user_xp_stats WHERE user_id = p_user_id) >= b.xp_requirement
      OR
      -- Check custom criteria (JSONB)
      EXISTS (
        SELECT 1 FROM xp_activities a
        WHERE a.user_id = p_user_id
        AND a.activity_type = (b.criteria->>'activity_type')
        AND COUNT(*) >= (b.criteria->>'count')::INTEGER
      )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Seed: Default Badges
INSERT INTO xp_badges (badge_name, badge_icon, badge_color, xp_requirement, criteria, description, category) VALUES
  ('First Blood', '🎯', '#228B22', 0, '{"activity_type": "candidate_added", "count": 1}', 'Candidate pertama ditambahkan', 'recruiter'),
  ('Candidate Hunter', '🎯', '#228B22', 500, '{"activity_type": "candidate_added", "count": 10}', '10 candidates ditambahkan', 'recruiter'),
  ('Talent Scout', '🔍', '#FFD700', 1000, '{"activity_type": "candidate_added", "count": 25}', '25 candidates ditambahkan', 'recruiter'),
  ('Interview Pro', '🎤', '#87CEEB', 0, '{"activity_type": "interview_completed", "count": 10}', '10 interview selesai', 'interviewer'),
  ('Closing Master', '🏆', '#FFD700', 0, '{"activity_type": "candidate_hired", "count": 5}', '5 candidates hired', 'closer'),
  ('Speed Demon', '⚡', '#FF4500', 0, '{"activity_type": "fast_response", "count": 10}', '10x response <1 jam', 'engagement'),
  ('Week Warrior', '💪', '#228B22', 0, '{"activity_type": "weekly_streak", "count": 4}', '4 minggu streak', 'engagement'),
  ('Level 10', '⭐', '#FFD700', 5000, '{}', 'Mencapai Level 10', 'general'),
  ('Level 20', '⭐⭐', '#FFD700', 15000, '{}', 'Mencapai Level 20', 'general'),
  ('Level 50', '⭐⭐⭐', '#FF4500', 50000, '{}', 'Mencapai Level 50', 'general');

-- Seed: Sample Challenges (Weekly)
INSERT INTO xp_challenges (challenge_name, challenge_type, activity_type, target_count, xp_reward, start_date, end_date) VALUES
  ('Add 10 Candidates This Week', 'weekly', 'candidate_added', 10, 200, DATE_TRUNC('week', NOW()), DATE_TRUNC('week', NOW()) + INTERVAL '6 days'),
  ('Complete 5 Interviews', 'weekly', 'interview_completed', 5, 300, DATE_TRUNC('week', NOW()), DATE_TRUNC('week', NOW()) + INTERVAL '6 days'),
  ('Hire 2 Candidates', 'weekly', 'candidate_hired', 2, 500, DATE_TRUNC('week', NOW()), DATE_TRUNC('week', NOW()) + INTERVAL '6 days'),
  ('Daily Login Streak (7 days)', 'weekly', 'daily_login', 7, 150, DATE_TRUNC('week', NOW()), DATE_TRUNC('week', NOW()) + INTERVAL '6 days');

-- Seed: Sample Rewards
INSERT INTO xp_rewards (reward_name, reward_description, xp_cost, reward_type, reward_data, stock, image_url) VALUES
  ('Coffee Voucher Rp 50K', 'Voucher kopi di coffee shop partner', 2000, 'voucher', '{"code": "COFFEE50", "vendor": "Kopi Kenangan"}', 50, '/rewards/coffee.png'),
  ('Lunch Voucher Rp 100K', 'Voucher makan siang', 4000, 'voucher', '{"code": "LUNCH100", "vendor": "Multiple"}', 30, '/rewards/lunch.png'),
  ('Online Course Access', 'Akses course LinkedIn Learning 1 bulan', 8000, 'perk', '{"platform": "LinkedIn Learning", "duration": "1 month"}', 10, '/rewards/course.png'),
  ('Extra Day Off', '1 hari cuti tambahan', 15000, 'perk', '{"type": "paid_leave", "days": 1}', 5, '/rewards/off.png'),
  ('Gift Card Rp 500K', 'Gift card general', 20000, 'voucher', '{"code": "GIFT500", "vendor": "Multiple"}', 3, '/rewards/gift.png');

-- RLS Policies
ALTER TABLE user_xp_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE xp_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE xp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_challenge_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE xp_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE xp_redemptions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own data
CREATE POLICY "Users can view own xp stats" ON user_xp_stats
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view own activities" ON xp_activities
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view own badges" ON user_badges
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view own challenge progress" ON user_challenge_progress
  FOR SELECT USING (auth.uid() = user_id);

-- Policy: HRD/Admin can view all (for leaderboard)
CREATE POLICY "HRD can view all xp stats" ON user_xp_stats
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users u 
      WHERE u.id = auth.uid() 
      AND u.role IN ('hrd', 'direksi')
    )
  );

-- Policy: Everyone can view active challenges and rewards
CREATE POLICY "Everyone can view challenges" ON xp_challenges
  FOR SELECT USING (is_active = true);

CREATE POLICY "Everyone can view rewards" ON xp_rewards
  FOR SELECT USING (is_active = true);

-- Policy: Users can redeem rewards
CREATE POLICY "Users can create redemptions" ON xp_redemptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own redemptions" ON xp_redemptions
  FOR SELECT USING (auth.uid() = user_id);
```

---

## 🧩 Integration Points

### 1. Initialize XP Stats on User Create
**File:** `src/app/api/users/route.ts` (atau wherever user creation happens)

```typescript
// After user is created in users table
await db.from('user_xp_stats').insert({
  user_id: newUser.id,
  current_xp: 0,
  level: 1,
  xp_to_next_level: 1000,
});

// Award "First Blood" badge if first user
await db.rpc('add_xp_to_user', {
  p_user_id: newUser.id,
  p_xp_amount: 25,
  p_activity_type: 'account_created',
  p_description: 'Account created',
});
```

### 2. Candidate Added
**File:** `src/app/api/candidates/route.ts`

```typescript
// After candidate is successfully created
const xpResult = await db.rpc('add_xp_to_user', {
  p_user_id: userId,
  p_xp_amount: 25,
  p_activity_type: 'candidate_added',
  p_description: `Candidate added: ${candidate.full_name}`,
  p_reference_id: candidate.id,
  p_reference_type: 'candidate',
  p_metadata: { position: candidate.position_id, brand: candidate.brand_id },
});

// Check for badge unlocks
const unlockedBadges = await db.rpc('check_badge_unlock', { p_user_id: userId });
```

### 3. Interview Completed
**File:** `src/app/api/interviews/route.ts`

```typescript
// After interview is marked as completed
await db.rpc('add_xp_to_user', {
  p_user_id: interviewerId,
  p_xp_amount: 40,
  p_activity_type: 'interview_completed',
  p_description: `Interview completed: ${candidateName}`,
  p_reference_id: interviewId,
  p_reference_type: 'interview',
});

// Bonus for scorecard filled
if (scorecard) {
  await db.rpc('add_xp_to_user', {
    p_user_id: interviewerId,
    p_xp_amount: 15,
    p_activity_type: 'interview_scorecard_filled',
    p_description: 'Interview scorecard completed',
    p_reference_id: interviewId,
    p_reference_type: 'interview',
  });
}
```

### 4. Candidate Status Updated to "Hired"
**File:** `src/app/api/candidates/[id]/route.ts`

```typescript
// When status changes to 'hired'
if (newStatus === 'hired' && oldStatus !== 'hired') {
  await db.rpc('add_xp_to_user', {
    p_user_id: userId,
    p_xp_amount: 100,
    p_activity_type: 'candidate_hired',
    p_description: `Candidate hired: ${candidate.full_name}`,
    p_reference_id: candidateId,
    p_reference_type: 'hiring',
  });
}
```

### 5. Daily Login
**File:** `src/app/(dashboard)/dashboard/layout.tsx` or middleware

```typescript
// Check if user logged in today
const { data: stats } = await db
  .from('user_xp_stats')
  .select('last_login')
  .eq('user_id', userId)
  .single();

const today = new Date().toDateString();
const lastLogin = stats?.last_login ? new Date(stats.last_login).toDateString() : null;

if (lastLogin !== today) {
  await db.rpc('add_xp_to_user', {
    p_user_id: userId,
    p_xp_amount: 5,
    p_activity_type: 'daily_login',
    p_description: 'Daily login bonus',
  });
  
  // Update last_login
  await db
    .from('user_xp_stats')
    .update({ last_login: today })
    .eq('user_id', userId);
}
```

---

## 🎨 Frontend Components

### New Components to Create

```
src/components/xp/
├── xp-progress-bar.tsx          # Level progress bar
├── xp-stats-card.tsx            # Quick stats (level, XP, streak)
├── xp-activity-feed.tsx         # Recent XP activities
├── xp-leaderboard.tsx           # Team leaderboard
├── xp-badge-collection.tsx      # Unlocked badges
├── xp-challenge-card.tsx        # Active challenges
├── xp-rewards-store.tsx         # Rewards redemption
├── xp-level-up-modal.tsx        # Celebration on level up
└── xp-sidebar-widget.tsx        # Compact XP widget for sidebar
```

### Example: XP Stats Card Component

```typescript
// src/components/xp/xp-stats-card.tsx
"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Trophy, Flame, Star } from "lucide-react";

interface XPStatsCardProps {
  currentXP: number;
  level: number;
  xpToNextLevel: number;
  streakDays: number;
  totalBadges: number;
}

export function XPStatsCard({
  currentXP,
  level,
  xpToNextLevel,
  streakDays,
  totalBadges,
}: XPStatsCardProps) {
  const progress = (currentXP / xpToNextLevel) * 100;

  return (
    <Card className="bg-gradient-to-br from-green-50 to-emerald-100 border-green-200">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-green-600 flex items-center justify-center text-white font-bold text-lg">
              {level}
            </div>
            <div>
              <p className="text-sm text-green-700 font-medium">Level {level}</p>
              <p className="text-xs text-green-600">Recruiter</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-orange-100 text-orange-700">
              <Flame className="w-3 h-3 mr-1" />
              {streakDays} day streak
            </Badge>
            <Badge variant="secondary" className="bg-yellow-100 text-yellow-700">
              <Star className="w-3 h-3 mr-1" />
              {totalBadges} badges
            </Badge>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-green-700 font-medium">{currentXP.toLocaleString()} XP</span>
            <span className="text-green-600">{xpToNextLevel.toLocaleString()} XP</span>
          </div>
          <Progress value={progress} className="h-2 bg-green-200" />
          <p className="text-xs text-green-600 text-center mt-2">
            {xpToNextLevel - currentXP} XP to Level {level + 1}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
```

---

## 📱 Dashboard Integration

### Update Main Dashboard Page
**File:** `src/app/(dashboard)/dashboard/page.tsx`

Add XP section at the top:

```tsx
// Add to imports
import { XPStatsCard } from "@/components/xp/xp-stats-card";
import { XPActivityFeed } from "@/components/xp/xp-activity-feed";
import { XPLeaderboard } from "@/components/xp/xp-leaderboard";

// In the component, fetch XP data
const [xpStats, setXpStats] = useState({
  currentXP: 0,
  level: 1,
  xpToNextLevel: 1000,
  streakDays: 0,
  totalBadges: 0,
});

useEffect(() => {
  const fetchXPStats = async () => {
    const { data } = await db
      .from('user_xp_stats')
      .select('*')
      .eq('user_id', user.id)
      .single();
    
    if (data) {
      setXpStats({
        currentXP: data.current_xp,
        level: data.level,
        xpToNextLevel: data.xp_to_next_level,
        streakDays: data.streak_days,
      });
    }
  };
  
  fetchXPStats();
}, [user.id]);

// Add to UI - Top section
<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-6">
  <div className="lg:col-span-2">
    <XPStatsCard {...xpStats} />
  </div>
  <div>
    <XPLeaderboard limit={5} />
  </div>
</div>

<div className="grid gap-6 md:grid-cols-2 mb-6">
  <XPActivityFeed userId={user.id} limit={10} />
  <XPChallengeCard userId={user.id} />
</div>
```

---

## 🚀 Implementation Roadmap

### Phase 1: Database & Core (Week 1)
- [ ] Run migration `006_add_xp_system.sql`
- [ ] Create TypeScript types for XP tables
- [ ] Implement `add_xp_to_user` RPC calls in API routes
- [ ] Test XP earning on candidate create/update

### Phase 2: Frontend Components (Week 2)
- [ ] Create XPStatsCard component
- [ ] Create XPActivityFeed component
- [ ] Create XPLeaderboard component
- [ ] Integrate into main dashboard

### Phase 3: Gamification (Week 3)
- [ ] Create XPBadgeCollection component
- [ ] Create XPChallengeCard component
- [ ] Implement level-up animation/modal
- [ ] Add XP sidebar widget

### Phase 4: Rewards & Polish (Week 4)
- [ ] Create XPRewardsStore component
- [ ] Implement redemption flow
- [ ] Add notifications for XP earned
- [ ] Mobile responsive
- [ ] Analytics tracking

---

## 📊 Analytics Events

```typescript
const XP_ANALYTICS = {
  xp_earned: 'XP Earned',
  level_up: 'Level Up',
  badge_unlocked: 'Badge Unlocked',
  challenge_completed: 'Challenge Completed',
  reward_redeemed: 'Reward Redeemed',
  leaderboard_viewed: 'Leaderboard Viewed',
};

// Track in each XP-earning action
analytics.track(XP_ANALYTICS.xp_earned, {
  user_id: userId,
  activity_type: 'candidate_added',
  xp_amount: 25,
  new_level: level,
});
```

---

## 🎯 Success Metrics

- **Daily Active Recruiters**: 80%+ login daily
- **Avg XP per User per Week**: 500+ XP
- **Challenge Completion Rate**: 60%+
- **Badge Collection**: Avg 5+ badges per user
- **Reward Redemption**: 30%+ users redeem monthly

---

*Created: 2026-05-02*
*For: TalentPool Recruitment System*
*Integration Guide by: OpenClaw Agent*

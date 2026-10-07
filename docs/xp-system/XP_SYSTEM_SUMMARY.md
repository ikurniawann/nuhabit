# 🎮 XP System Summary - TalentPool

## ✅ What's Been Created

### 1. **Database Schema** (`database/migrations/006_add_xp_system.sql`)
- ✅ 8 new tables for XP system
- ✅ Auto level calculation function
- ✅ Badge unlock system
- ✅ Challenge reward claiming
- ✅ Reward redemption with stock management
- ✅ RLS policies for security

### 2. **Frontend Components** (`src/components/xp/`)
- ✅ `xp-stats-card.tsx` - Main XP display with level, progress, streaks
- 🔄 `xp-activity-feed.tsx` - Recent XP activities (TODO)
- 🔄 `xp-leaderboard.tsx` - Team ranking (TODO)
- 🔄 `xp-badge-collection.tsx` - Unlocked badges (TODO)
- 🔄 `xp-challenge-card.tsx` - Active challenges (TODO)
- 🔄 `xp-rewards-store.tsx` - Rewards redemption (TODO)

### 3. **XP Service Library** (`src/lib/xp.ts`)
- ✅ XP rules configuration
- ✅ Level calculation utilities
- ✅ XPService class with all PostgreSQL RPC calls
- ✅ Methods: addXP, getUserStats, getBadges, getChallenges, redeemReward, etc.

### 4. **Documentation**
- ✅ `XP_SYSTEM_INTEGRATION.md` - Complete system design & schema
- ✅ `XP_INTEGRATION_EXAMPLES.md` - Code examples for integration
- ✅ `XP_SYSTEM_SUMMARY.md` - This file

---

## 🎯 XP Earning Activities

| Activity | XP | Description |
|----------|-----|-------------|
| 📝 Candidate added | +25 | Per candidate created |
| 🔄 Candidate updated | +10 | Status/notes update |
| 📋 Candidate screening | +15 | CV screening completed |
| 📅 Interview scheduled | +20 | Interview scheduled |
| 🎤 Interview completed | +40 | Interview finished |
| 📊 Scorecard filled | +15 | Interview scorecard |
| 🎉 Candidate hired | +100 | **Big bonus!** |
| 🏊 Talent pooled | +30 | Candidate to talent pool |
| 🔥 Daily login | +5 | First login of the day |
| ⚡ Fast response | +20 | Response <1 hour |
| 💪 Weekly streak | +50 | 7 days active |
| 📝 Complete profile | +25 | 100% candidate profile |
| 👥 Referral hired | +150 | **Super bonus!** |

---

## 🏆 Level System

**Formula:** `level = floor(sqrt(total_xp / 1000)) + 1`

| Level | Title | Total XP Needed |
|-------|-------|-----------------|
| 1 | Recruiter | 0 XP |
| 2 | Recruiter | 1,000 XP |
| 3 | Recruiter | 3,000 XP |
| 4 | Recruiter | 6,000 XP |
| 5 | **Senior Recruiter** | 10,000 XP |
| 10 | **HR Manager** | 37,500 XP |
| 15 | **HR Director** | 85,000 XP |
| 20 | **VP of Talent** | 157,500 XP |

---

## 🎖️ Sample Badges

### Recruiter Badges
- 🎯 **First Blood** - First candidate added
- 🎯 **Candidate Hunter** - 500 XP from candidates
- 🔍 **Talent Scout** - 1000 XP from candidates

### Interviewer Badges
- 🎤 **Interview Pro** - 500 XP from interviews

### Closer Badges
- 🏆 **Closing Master** - 1000 XP from hirings

### Engagement Badges
- ⚡ **Speed Demon** - 200 XP from fast responses
- 💪 **Week Warrior** - 200 XP from streaks

### Level Badges
- ⭐ **Level 5** - Reached Level 5
- ⭐⭐ **Level 10** - Reached Level 10
- ⭐⭐⭐ **Level 20** - Reached Level 20

---

## 🎁 Rewards Store Examples

| Reward | XP Cost | Type |
|--------|---------|------|
| ☕ Coffee Voucher Rp 50K | 2,000 XP | Voucher |
| 🍱 Lunch Voucher Rp 100K | 4,000 XP | Voucher |
| 📚 Online Course (1 month) | 8,000 XP | Perk |
| 🏖️ Extra Day Off | 15,000 XP | Perk |
| 🎁 Gift Card Rp 500K | 20,000 XP | Voucher |

---

## 📊 Example User Journey

### Day 1: New Recruiter
```
Login: +5 XP
Add 5 candidates: +125 XP (5 × 25)
Complete 2 interviews: +80 XP (2 × 40)
Update 3 candidates: +30 XP (3 × 10)
Total: 240 XP → Level 1
Badge unlocked: 🎯 First Blood!
```

### Week 1: Active Recruiter
```
Daily logins (5 days): +25 XP
Add 15 candidates: +375 XP
Complete 8 interviews: +320 XP
Hire 2 candidates: +200 XP
Weekly streak: +50 XP
Total: 970 XP (cumulative: 1,210 XP) → Level 2!
```

### Month 1: Top Performer
```
Daily logins (22 days): +110 XP
Add 50 candidates: +1,250 XP
Complete 30 interviews: +1,200 XP
Hire 8 candidates: +800 XP
Fill 25 scorecards: +375 XP
Weekly streaks (4): +200 XP
Total: 3,935 XP (cumulative: 5,145 XP) → Level 3
Badges: 🎯 Candidate Hunter, 🎤 Interview Pro
```

---

## 🚀 Next Steps

### Phase 1: Database Setup (TODAY)
1. ✅ Migration file created
2. ⏳ Run migration via npm run db:migrate:apply:
   ```bash
   # Option A: Via npm run db:migrate:apply
   npm run db:migrate:apply
   
   # Option B: Via admin database
   # Copy paste 006_add_xp_system.sql to SQL Editor
   ```

### Phase 2: Integration (This Week)
3. ⏳ Add XP calls to existing API routes:
   - `src/app/api/candidates/route.ts` - Add XP on create/update
   - `src/app/api/interviews/route.ts` - Add XP on complete
   - `src/app/(dashboard)/dashboard/layout.tsx` - Daily login bonus

4. ⏳ Integrate XPStatsCard in dashboard:
   - Add to main dashboard page
   - Add to sidebar widget

### Phase 3: Complete Components (Next Week)
5. ⏳ Create remaining components:
   - `xp-activity-feed.tsx`
   - `xp-leaderboard.tsx`
   - `xp-badge-collection.tsx`
   - `xp-challenge-card.tsx`
   - `xp-rewards-store.tsx`

6. ⏳ Create XP Dashboard page:
   - `src/app/(dashboard)/dashboard/xp/page.tsx`

### Phase 4: Testing & Launch (Week 3)
7. ⏳ Test all XP earning scenarios
8. ⏳ Test badge unlocks
9. ⏳ Test challenge progress
10. ⏳ Test reward redemption
11. ⏳ Deploy to production

---

## 📈 Success Metrics

Track these after launch:

- **Daily Active Recruiters**: Target 80%+ login daily
- **Avg XP per User per Week**: Target 500+ XP
- **Challenge Completion Rate**: Target 60%+
- **Badge Collection**: Avg 5+ badges per user
- **Reward Redemption**: 30%+ users redeem monthly
- **Candidate Addition Rate**: Increase 30%+ (gamification effect)
- **Interview Completion Rate**: Increase 25%+

---

## 🎨 UI Preview

### Dashboard Header
```
┌─────────────────────────────────────────────────────────┐
│  Level 5 • Senior Recruiter      XP: 10,450 / 15,000   │
│  ████████████████████████░░░░░░░░░░░░░░░░ 69.7%        │
│  🔥 12 day streak  ⭐ 8 badges                          │
└─────────────────────────────────────────────────────────┘
```

### Activity Feed
```
✅ +100 XP | Candidate hired: PT. ABC Corp      2 min ago
✅ +40 XP  | Interview completed: Mr. John      15 min
✅ +25 XP  | Candidate added: Sarah Ahmad       1 hour
✅ +20 XP  | Interview scheduled: Developer     2 hours
🏆 +200 XP | Badge unlocked: Candidate Hunter!  Yesterday
```

### Leaderboard (This Week)
```
1. 🥇 Sarah    │ Level 8 │ 18,450 XP │ ██████████
2. 🥈 You      │ Level 5 │ 10,450 XP │ ██████░░░░
3. 🥉 Ahmad    │ Level 5 │  9,890 XP │ ██████░░░░
4. Budi        │ Level 4 │  7,200 XP │ █████░░░░░
5. Citra       │ Level 4 │  6,100 XP │ ████░░░░░░
```

---

## 💡 Pro Tips

1. **Start Small**: Launch with just XP earning + level system first
2. **Add Gradually**: Roll out badges, then challenges, then rewards
3. **Get Feedback**: Ask team what rewards they actually want
4. **Monitor Abuse**: Watch for fake candidate additions just for XP
5. **Celebrate Wins**: Announce level ups in team chat
6. **Update Challenges**: Refresh weekly challenges every Monday
7. **Keep it Fun**: Don't make it feel like surveillance

---

## 🆘 Troubleshooting

### XP not earning?
- Check if migration ran successfully
- Verify `add_xp_to_user` RPC function exists
- Check RLS policies allow inserts

### Level not updating?
- Check level calculation formula in function
- Verify `total_xp_earned` is accumulating
- Test in psql: `SELECT add_xp_to_user(...)`

### Badge not unlocking?
- Check `check_badge_unlocks` function
- Verify badge criteria in `xp_badges` table
- Ensure badge is `is_active = true`

### Challenge progress not updating?
- Check `activity_type` matches in `xp_challenges` table
- Verify `user_challenge_progress` table has entry for user
- Check challenge `is_active` and date range

---

## 📞 Support

For questions or issues:
- Check `XP_SYSTEM_INTEGRATION.md` for full schema
- Check `XP_INTEGRATION_EXAMPLES.md` for code examples
- Review app / PostgreSQL logs for RPC function errors
- Test functions in psql first

---

**Created:** 2026-05-02  
**Status:** ✅ Ready for Phase 1 (Database Migration)  
**Next:** Run migration via npm run db:migrate:apply, then integrate API routes

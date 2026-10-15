# Norwegian Badminton Elo

Elo ratings for Norwegian badminton players in singles and doubles, calculated from match results on [badmintonportalen.no](https://badmintonportalen.no).

## Match data

- **Sources:**
  - Team matches (league play) from September 2013 onwards.
  - Tournament matches from September 2014 onwards. Tournaments in the 2013/2014 season have no results registered.
- **Disciplines:** men's singles, women's singles, men's doubles, women's doubles and mixed doubles, rated as five separate pools. A player has a separate rating in each discipline they play.
- **Pool by event:** the event decides the pool, not the player. A woman playing men's singles is rated in the men's pool for that match.
- **Excluded:** walkovers (including 21-0, 21-0 results, and 15-0, 15-0 from 2026/2027), unplayed matches, tournaments without results and matches removed in [corrections](#corrections).

## Rating formula

The ratings follow the [standard Elo rating system](https://en.wikipedia.org/wiki/Elo_rating_system#Theory).

### Expected score

For player $A$ with rating $R_A$ against player $B$ with rating $R_B$, the expected score of $A$ is

$$
E_A = \frac{1}{1 + 10^{(R_B - R_A)/300}}
$$

and $E_A + E_B = 1$. A rating difference of 300 points means the stronger player is expected to win about 91% of the time. (Standard Elo uses 400; this system uses a 0.75 scale throughout so that the top ratings end around 3000.)

### Rating update

After a match, player $A$'s rating becomes

$$
R_A' = R_A + K_A \, (S_A - E_A)
$$

where $S_A = 1$ for a win, $S_A = \tfrac{1}{2}$ for a draw and $S_A = 0$ for a loss.

Draws happen in some junior and lower senior leagues that play at most two sets: a match ending 1-1 in sets is a draw.

### K-factor

The K-factor scales the base factor $\kappa$ by the adjustments described below:

$$
K_A = \kappa \cdot w_c \cdot w_j \cdot w_m \cdot w_r \cdot m(R_A) \cdot c_t
$$

| Symbol   | Meaning                                                     |
| -------- | ----------------------------------------------------------- |
| $\kappa$ | Base K-factor                                               |
| $w_c$    | [Class level weight](#class-level-weight)                   |
| $w_j$    | [Junior weight](#junior-weight)                             |
| $w_m$    | [Margin of victory weight](#margin-of-victory-weight)       |
| $w_r$    | [Cross-region weight](#cross-region-weight)                 |
| $m(R_A)$ | [Current rating multiplier](#current-rating-multiplier)     |
| $c_t$    | [Covid-19 K-factor adjustment](#covid-19-period-adjustment) |

$m(R_A)$ depends on each player's own rating, so the two players in a match can gain and lose different amounts.

### Doubles

Each player has their own doubles rating; pairs have no rating of their own. A side plays at the sum of its two players' ratings, and the expected score compares the sums:

$$
E_{AB} = \frac{1}{1 + 10^{\left((R_C + R_D) - (R_A + R_B)\right)/300}}
$$

So a pair whose players are each 100 points better than their opponents is a 200-point favourite. The side's rating change $K \, (S - E_{AB})$ is shared between the partners by their [rating uncertainty](#rating-uncertainty):

$$
R_A' = R_A + K_A \cdot \frac{RD_A^2}{RD_A^2 + RD_B^2} \, (S - E_{AB})
$$

with $K_A$ as above. Two equally established partners get half each. A newcomer playing with an established partner takes most of the change, since the result says more about the newcomer's unknown level than about the partner's well-known one.

Tuning used doubles matches before 2023 and was tested on 2023 onwards, counting only games where all four players have 10+ matches in the discipline (log loss, lower is better):

| Side rating                                           | 2023 onwards |
| ----------------------------------------------------- | -----------: |
| Sum of the partners' ratings, $\kappa = 54$ (used)    |       0.4519 |
| Average of the partners' ratings, best $\kappa$ (120) |       0.4560 |
| Average of the partners' ratings, $\kappa = 54$       |       0.4723 |

- **Average:** averaging the ratings made every doubles match look closer than it was, and a larger K-factor only partly made up for it. The same holds with stricter thresholds of 30 or 60 matches.
- **K-factor:** with the sum, the best $\kappa$ is the same as in singles.
- **Split:** sharing the change equally instead of by uncertainty predicted the pre-2023 matches equally well, and later matches slightly worse.

Doubles ratings are their own scale. The top doubles players are around 2100, against about 3000 in singles, so the two can't be compared directly.

#### Start rating from singles

A player who has played singles before their first doubles match starts doubles from their singles rating at that moment, instead of the class start rating:

$$
R_{\text{doubles}} = p_0 + 0.6 \cdot (R_{\text{singles}} - p_0)
$$

A 2400 singles player starts doubles at 1940. The factor 0.6 brings the singles rating onto the narrower doubles scale. Mixed doubles uses the singles discipline the player has played most. Players without singles keep the class start rating.

This and the [junior weight](#junior-weight) were inspired by table tennis rating systems (such as Germany's TTR, which raises the K-factor for juniors) and tuned on doubles matches before 2023, then tested on 2023 onwards. Here all doubles games count, including those with newcomers, where the start rating matters most (log loss, lower is better):

| 2023 onwards, doubles               | Before | With both | Change |
| ----------------------------------- | -----: | --------: | -----: |
| All doubles games                   | 0.5304 |    0.5066 |  −4.5% |
| Games with a newcomer (<10 matches) | 0.6302 |    0.5877 |  −6.7% |
| Games between settled players       | 0.4515 |    0.4425 |  −2.0% |
| Favourite wins                      |  73.0% |     74.7% |        |

The pre-2023 matches improved as much. Seeding from singles is most of the gain: just compressing the class start ratings towards 1500 helped far less. Factors from 0.55 to 0.65 did about equally well.

## Parameters

| Parameter                        |    Value |
| -------------------------------- | -------: |
| Top level start rating $p_0$     |     1500 |
| Base K-factor $\kappa$           |       54 |
| Doubles start from singles       |     ×0.6 |
| Junior weight $w_j$              |     ×1.5 |
| Doubles maximum rating deviation |      130 |
| Expected score scale             |      300 |
| Cross-region weight              |       ×2 |
| Not playing grace period $g$     | 365 days |
| Not playing half-life $h$        |  3 years |

## Start rating

A player's start rating is set by the level of their first rated match, for juniors and seniors alike: from $p_0 = 1500$ at the top level down to 1050 (see the [class levels table](#class-level-weight)). A newcomer in SEN D starts at 1275, the same as one in U15A, since the two levels are treated as equal.

Starting every senior at 1500 regardless of level was tested and predicted results clearly worse: adult beginners started several hundred points too high, and the extra points ended up with the players who beat them.

In doubles, players who have played singles start from their singles rating instead (see [start rating from singles](#start-rating-from-singles)).

After the start, ratings only change through results. Juniors who improve quickly catch up through $m(r)$, which gives players below $p_0$ larger rating changes, and the [junior weight](#junior-weight), which counts junior matches ×1.5.

> [!NOTE]
> The 2013/2014 and 2014/2015 seasons are a warm-up. 2013/2014 only has team matches (senior, U15 and U13 leagues), and most players get their first rated match in 2014/2015 when tournament data starts, so ratings need until about the end of 2014/2015 to settle.

## Adjustments

### Class level weight

$w_c$ depends on the tournament class or team league the match is played in. The same levels set a new player's [start rating](#start-rating):

| Tournament class       | Team league                                                                                                            | $w_c$ | Start rating |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----: | -----------: |
| SEN X, SEN E, SEN A    | Eliteserien (incl. qualification); 1. HS and 1. DS in 1st div                                                          |  100% |         1500 |
| U19A/X, SEN B, O35–O45 | 2. and 3. HS and 2. DS in 1st div; Junior NM for lag (U19)                                                             |   85% |         1425 |
| U17A/X, SEN C, O50–O55 | 2nd div; 1st div qualification; U17 leagues, Landsfinale U17; U17/U19 singles series                                   |   60% |         1350 |
| U15A/X, SEN D, O60+    | 3rd div (incl. combined 2nd/3rd div); U15 leagues, Landsfinalen U15                                                    |   40% |         1275 |
| U13A/X, U19B, U17B     | U13 leagues, Landsfinalen U13; U13/U15 singles series                                                                  |   25% |         1200 |
| U11A, U15B, U13B       | 4th div; other senior series (Oslofjordserien, Klubbserie, Trimliga, Pizzaliga, Herreserien, adult beginner series, …) |   10% |         1125 |
| Other (incl. Åpen HC)  | Junior beginner series (Nybegynnerserie); internal club events                                                         |    5% |         1050 |

League names vary by region and season ("1. divisjon Østlandet", "1. Div Oslofjorden 18/19", "2.div. Sør", …), so they are matched by pattern.

### Junior weight

$w_j = 1.5$ for matches in junior classes and leagues (U9–U19), in every discipline, otherwise 1. The class level weights above lower the K-factor in junior classes on purpose, since junior results say less about a player's level on the senior scale. But juniors improve faster than that lets their ratings follow, so their ratings lagged behind their results. The idea comes from table tennis: Germany's TTR system raises the K-factor for young players.

Tuned on matches before 2023 and tested on 2023 onwards, all games counted (log loss, lower is better; change in thousandths):

| Junior weight | Singles before 2023 | Singles 2023 onwards | Doubles before 2023 | Doubles 2023 onwards |
| ------------- | ------------------: | -------------------: | ------------------: | -------------------: |
| ×1 (none)     |              0.5129 |               0.5153 |              0.5208 |               0.5304 |
| ×1.25         |                −2.9 |                 −3.1 |                −3.5 |                 −3.2 |
| **×1.5**      |            **−3.9** |             **−4.5** |            **−5.0** |             **−4.7** |
| ×1.75         |                −3.6 |                 −4.4 |                −5.0 |                 −4.8 |
| ×2            |                −2.2 |                 −3.2 |                −3.7 |                 −3.8 |
| ×2.5          |                     |                      |                +2.0 |                 +0.8 |

×1.5 was best or as good as the best in every column, for newcomers and settled players alike, and ratings did not drift. In singles the favourite now wins 74.0% of these games (73.4% without it). The doubles figures are without the [start rating from singles](#start-rating-from-singles), which was added together with it.

### Margin of victory weight

$w_m$ depends on how one-sided the match was. With $d$ the point difference divided by the total points played,

$$
w_m = \min\left(3,\ \frac{\max(d,\ 0.02)}{0.2}\right)
$$

A typical margin ($d = 0.2$, e.g. 21-15, 21-13) gives $w_m = 1$. A close match such as 22-20, 21-19 gives about $\tfrac{1}{4}$, and a blowout such as 21-5, 21-3 is capped at 3. Draws use $w_m = 1$.

Adding the margin of victory improved predictions more than any other change tested (about 5% lower log loss on seasons not used for tuning).

The margin also covers match length: three-set matches almost always have a small point difference, so they already count less. An earlier separate weight for three-set wins (85%) was removed, since it lowered them twice and made predictions slightly worse.

### Cross-region weight

$w_r = 2$ when the two players' clubs belong to different regional associations (kretser), otherwise $w_r = 1$. Clubs are mapped to regions using badmintonportalen's club list; clubs that no longer exist use the region of the regional leagues they played in. Foreign players and combined league teams have no region and get $w_r = 1$.

Players in isolated regions mostly meet each other, so their ratings drift away from the rest of the country: before this weight, players from Hålogaland, Finnmark, Innlandet and Midtnorsk Sør scored 0.05–0.08 below their expected score against players from other regions. Doubling the weight of games between regions moves more points per game and reduces that gap by about a quarter. A higher weight reduced the gap further but made predictions worse overall.

### Current rating multiplier

Allows lower rated players to advance more rapidly, while stabilizing ratings at the top:

$$
m(r) = 1 + \frac{2}{1 + 2^{(r - p_0)/90}}
$$

where $r$ is the player's current rating. $m(r)$ approaches 3 far below $p_0$, equals 2 at $p_0$ and approaches 1 far above $p_0$.

### Walkovers

Walkovers are not rated (weight 0%). A 21-0, 21-0 result is treated as a walkover entered as a score; from the 2026/2027 season, when sets go to 15, so is 15-0, 15-0.

### Corrections

Results that are wrong on badmintonportalen can be corrected by hand in `elo/corrections.txt`, which `rate.mjs` applies on every run, so corrections survive refetching the data. One match per line, identified by its match key (shown under each match on the player pages):

```
T7143 47570 vs 24320  walkover  # Mossetreffen 2026: 21-1 21-1 is impossible with sets to 15
```

The key is `T<tournament id>` or `L<league tie id>` followed by the player ids of each side (`id+id` in doubles). When the same sides meet more than once in a tournament (in a group and again in a knockout round), the later meetings are numbered in playing order: `T588.2 26596 vs 24788`. A correction is `walkover`, `remove`, `score <sets>` (the winner follows from the score) or `winner <1|2>`; `score` and `winner` follow the side order written in the line. Lines that match no match are reported when rating. A `score` line with the score as recorded changes nothing; it marks the score as checked, so the match is no longer listed for review.

Each run also writes `data/suspicious-scores.txt`, the scores worth checking, newest first, as lines ready to copy into `corrections.txt`:

- **Impossible for the season's set format.** Sets are won by 2 points up to a cap: to 21 (cap 30) until 2025/2026, to 15 (cap 21) from 2026/2027, and to 11 (cap 15) or 15 in some junior classes. A 21-1 set in 2026/2027, or 22-21, can't happen. Tournaments where more than a fifth of the scores break these formats evidently played their own (Sandefjord SaBK Open and Vestre Aker Fjærfest 2015) and are left out.
- **Extreme blowouts**, where the loser scored at most 1 point per set. Most are real mismatches in junior and beginner classes, but some are no-shows entered as a score.

For impossible scores the list suggests the most likely intended score, assuming one typo per wrong set: the valid score in the match's own set format, with the same set winner, that is one typo away (a digit changed, added, removed or two digits swapped), preferring the smallest change in points and then keeping the winner's score. 18-15 becomes 18-16 and 12-25 with sets to 15 becomes 12-15. Scores without a single clear fix, which are mostly matches cut short (14-11, 21-14), are marked "no clear fix". A suggestion never changes who won a set, so it never changes who won the match.

Nothing is changed until a line is in `corrections.txt`. The 575 scores listed in October 2026 were all added there, with the suggested fixes applied (314) and the rest kept as recorded, for review.

## Not playing penalty

After a grace period of $g = 365$ days without playing, the part of the rating above $p_0$ decays with a half-life of $h = 3$ years (1095 days). A player with rating $r > p_0$ who has not played for $t > g$ days has the rating

$$
r(t) = p_0 + (r - p_0) \cdot 2^{-(t - g)/h}
$$

Ratings at or below $p_0$ are not affected, so juniors taking a break keep their rating. During the [Covid-19 period](#covid-19-period-adjustment), days count at the reduced not playing penalty rate.

For example, a player at 2400 who stops playing keeps that rating for a year, has about 2214 after two years away and about 1950 after four.

The grace period covers the summer break: the season runs from about September to April, so active players often go more than six months between matches. The half-life is fitted to the data: players above $p_0$ returning after a year or more away perform as their decayed rating predicts.

## Rating uncertainty

Every rating comes with a $\pm$ range showing how reliable it is, based on the [Glicko](https://en.wikipedia.org/wiki/Glicko_rating_system) rating deviation $RD$. The range is $\pm 2 \cdot RD$, so the player's true level is within it with about 95% probability. The $RD$ is shown alongside the rating. In singles it does not change how ratings move; in doubles it decides how a side's rating change is shared between the partners.

New players start at $RD = 260$ ($\pm 520$), or $130$ in doubles (see below). Time without playing increases it:

$$
RD' = \min\left(260,\ \sqrt{RD^2 + c^2 t}\right)
$$

where $t$ is the number of days since the last match and $c$ is set so that an $RD$ of 40 grows back to 260 in about 10 years. Each match then reduces it:

$$
RD' = \left(\frac{1}{RD^2} + q^2 \, g(RD_B)^2 \, E (1 - E)\right)^{-1/2}, \qquad q = \frac{\ln 10}{300}, \qquad g(RD) = \frac{1}{\sqrt{1 + 3 q^2 RD^2 / \pi^2}}
$$

where $E$ is the expected score against opponent $B$, adjusted for $B$'s uncertainty. Matches with an almost certain result (against a much weaker or stronger opponent) say little about a player's level, so they reduce the $RD$ only a little. Top players who mostly play much weaker opponents therefore keep a wider range than players with many close matches.

The growth rate and the use of all matches (without class level weights) were fitted to the data: with these settings, players' actual results match the uncertainty the ranges predict.

In doubles, a player is measured against the opposing side's summed rating, with $RD_B = \sqrt{RD_C^2 + RD_D^2}$. The doubles maximum, and with it the growth rate, is half the singles one: $RD_{max} = 130$. This was checked by splitting each player's games into blocks of 10. For each block, the rating that best explains its results (given the other players' ratings) differs from the player's rating before the block by the measurement noise of 10 games plus the player's true error. That error should match the $RD$:

| Pool                             | True error / $RD$ |
| -------------------------------- | ----------------: |
| Singles                          |               1.1 |
| Doubles, $RD_{max} = 260$        |              0.78 |
| Doubles, $RD_{max} = 130$ (used) |              1.05 |

With the singles maximum, doubles ranges were about 30% too wide.

## Rankings

Ranking lists only include players who have played in the last 12 months, with time during Covid-19 counting slower (see [Covid-19 period adjustment](#covid-19-period-adjustment)). Inactive players keep their rating and history, and reappear in the rankings as soon as they play again. The rankings page can show them too (without a rank) with "Show inactive players".

The club shown for a player is their club registered on badmintonportalen. Players no longer in the register show the club of their last tournament, or otherwise the club of their last league team. League team names such as "Kristiansand 2" are team numbers, not clubs.

### Ranking history

At the top of a player's page, one chart shows their national rank at the end of every week since they started, with a line per discipline, and a table of their rank at the end of each season. The weekly rank uses the same rules as the ranking lists: players are ranked by their rating at the end of the week, among players active then (Covid-adjusted), and in mixed doubles among men or among women. The current week is the ranking itself. The chart has a logarithmic scale with #1 at the top, so a climb from #100 to #50 looks as big as one from #20 to #10.

The ranks are in `data/history/<id>.json` (`ranks`, alongside `ratings`; they run on past the last rating week while the player is still active) and the number of ranked players per week in `data/rank-counts.json`. Each history also has `seasons`, the rating, club, rank and number of ranked players at the end of each season, precomputed by `rate.mjs` for the tables on the player page.

### Mixed doubles: men and women ranked separately

Mixed doubles is rated as one pool, but men and women are ranked in separate lists. Nearly every mixed pair is one man and one woman (32,297 of the 32,425 pairs where both genders are known), so results show how men compare with other men and women with other women, but not how men's mixed ratings compare with women's: raising every man's rating by the same amount and lowering every woman's would predict every result the same.

Gender comes from badmintonportalen's player register. For players not in it, it is the opposite of most of their mixed doubles partners' genders, or otherwise female if they have played women's singles or doubles. Players whose gender is still unknown get no mixed doubles rank.

### Strongest clubs

Clubs are ranked per pool by a weighted average of their best ranked players (singles) or pairs (doubles), the best counting most:

| Pool                           | Counted                                                                  | Weights, best first |
| ------------------------------ | ------------------------------------------------------------------------ | ------------------- |
| Men's singles, women's singles | best 4 players                                                           | 40% · 30% · 20% · 10% |
| Men's doubles, women's doubles | best 3 pairs: the club's two best players, the next two, the next two    | 50% · 33% · 17%     |
| Mixed doubles                  | best 4 pairs: its best man with its best woman, the second best of each, … | 40% · 30% · 20% · 10% |

A pair counts at the average of its two players' ratings, which keeps doubles strengths on the same scale as the players' doubles ratings. Pairs are formed from the club's ranked players by rating, not from who actually plays together. In mixed doubles each pair has a man and a woman, since men's and women's mixed ratings can't be compared (see above).

Places a club can't fill (a missing player, or a missing partner) count at the lowest rating among ranked players in the pool (in mixed doubles, among men or among women). So every club with at least one ranked player is listed, and smaller clubs rank lower, as they should; adding a real player can never make a club weaker. Counting the best few, rather than all players, keeps big clubs with many beginners from being ranked low, and the falling weights keep one-star clubs from being ranked high.

The combined list ranks clubs by their average standard score in all five disciplines, so only clubs listed in every discipline are included. In each discipline, a club's score is its strength minus the average strength of the listed clubs, divided by the standard deviation of their strengths: 0 is an average listed club, +1 one standard deviation above it. The pools are separate rating scales with different spreads (doubles ratings span a narrower range at the top), so averaging the strengths themselves would let singles count for more. Standard scores make each discipline count equally.

### Club strength history

Each club page shows the club's strength per pool at the end of every week since 2013, with its rank among clubs that week. It is the same weighted average of the best ranked players or pairs as above, using the ratings at the time, with the lowest rating among players active that week for places a club can't fill. A player counts for a week if they were active then (played in the 12 months before it, Covid-adjusted as for the rankings), for the club they played for at the time (as in a player's [club history](#club-history)). Weeks where the club had no ranked player leave a gap.

The current week is the club ranking itself, so the graph ends on the strength and rank shown next to it. That ranking uses players' registered clubs, so a player who has just changed clubs (and not yet played for the new one) shows up as a step in the last week. The history is written per club to `data/club-history/<NBF club id>.json`, only for clubs in badmintonportalen's club list, with each discipline's strength, rank and number of clubs at the end of each season precomputed (`seasons`) for the tables. On the club page each discipline is a tab, as on the player page, below the graphs of all disciplines together.

The club page also shows all five disciplines on one graph, and the combined score over time. The combined history uses the same standard scores as the combined ranking, computed each week among the clubs with a strength in all five disciplines that week, so a club has no combined value in weeks it was too small to be listed in every discipline. Its current week is also the combined ranking itself.

### Matches

A player's page has one tab per discipline they have played, with a graph of all their disciplines together above the tabs. Each tab lists all their matches, showing the last 20 with a button to show all (`data/matches/<id>.json` holds every match, newest first). A Highlights box, with a tab for each, lists their 5 biggest wins and losses and the 5 matches that raised and lowered their rating most (largest rating change, in any match). Biggest wins are the wins with the lowest win chance before the match ($E_A$); biggest losses are the losses with the highest. Only matches where both players already had 10 rated matches count, since start ratings are too uncertain to make an upset meaningful.

### Rivals

A player's biggest rival is the opponent they have had the closest matches against, measured by the average point margin $d$ (as in the [margin of victory weight](#margin-of-victory-weight)) over at least 3 matches. To favour many close matches over a few, the average is pulled towards a typical margin of 0.2 as if there were 2 more matches: $(\sum d + 2 \cdot 0.2) / (n + 2)$. The player page shows the closest 3.

### Club history

The rating graph is coloured by the club the player played for at the time: the club of their last tournament, if it was within the last 12 months, otherwise the club of their last league team.

### Women's singles first

On the page of a woman (by gender in badmintonportalen's player register) who has also played men's singles, women's singles is shown first.

### Clubs in Craft

Clubs are entries in the Clubs section (`elo/clubs/<slug>`), created and updated from `data/clubs.json` with `ddev craft elo/clubs/sync`. The sync only writes the short name, full name, region and NBF club ID; logos and websites are added by hand in the control panel and kept. Players are matched to a club entry by its short name (the entry title).

## Tested and not used

### Repeated opponents

Making repeated matches against the same opponent count less (to reward playing a wider range of opponents) was tested with several weights: $a^n$ for $n$ earlier meetings in the last one or two years ($a$ from 0.6 to 0.9), $1/\sqrt{1+n}$ and $1/(1+n)$. Every variant predicted results worse, both on the tuning seasons and the held-out seasons (2023 onwards), and the stronger the reduction the worse. Counting repeated matches more did not help either. Repeated matches carry as much information about the players as any other match, so all matches count the same.

### Higher K-factor for newcomers

Table tennis systems such as TTR raise the K-factor for a player's first matches. A higher K-factor for a player's first 10, 20 or 30 doubles matches (×1.5 or ×2) predicted results worse on both the tuning and the held-out seasons, and made ratings drift down, since newcomers then lose more points than their opponents win. The same held for singles. Doubles newcomers already move fast, since they take most of their side's rating change (see [doubles](#doubles)).

### Matches against unsettled players counting less

The idea: a result against a player whose rating is still uncertain says less, so it should move ratings less, as in the Glicko system. Tested on matches before 2023 and on 2023 onwards, all games counted, in thousandths of log loss compared with the rules used (positive = worse):

| Variant                                                             | Singles before 2023 | Singles 2023 onwards | Doubles before 2023 | Doubles 2023 onwards | Average rating drift |
| ------------------------------------------------------------------- | ------------------: | -------------------: | ------------------: | -------------------: | -------------------: |
| Change × $g(RD)$ of the opponents (Glicko)                          |                +5.5 |                 +6.5 |                +2.3 |                 +3.9 |                  −15 |
| Change × $g(RD)^3$                                                  |               +19.6 |                +23.3 |                +8.6 |                +13.0 |                  −22 |
| Opponents with fewer than 10 matches count ×0.5                     |               +24.9 |                +30.3 |               +21.9 |                +32.1 |                  −30 |
| Change × $g(RD)$, $\kappa$ ×1.25 to make up for the smaller changes |                +6.0 |                 +6.7 |                +2.7 |                 +3.1 |                  −17 |

Every variant predicted worse, and the stronger the discount the worse; a higher K-factor did not make up for it. Newcomers here are not unknowns: their start rating comes from the class they enter (and from their singles rating in doubles), so a result against them still says a lot about the established player. Discounting only the established player's change also lets rating points leak out, so ratings drifted down over the years. Where uncertainty does matter, in doubles, the side's rating change is already shared by the partners' uncertainty.

## Comparison with the official ranking

The official NBF ranking lists (badmintonportalen.no/NBF/Ranglister/) rank seniors by points collected in tournaments over the last 12 months. For each season from 2014/2015, the season's final official list and these ratings on the same date were both used to pick the favourite in every game played in the following 12 months between two players on the list (`fetch-ranking.mjs`, `compare-ranking.mjs`):

|                                |  Games | Favourite won |
| ------------------------------ | -----: | ------------: |
| Official ranking (more points) | 40,655 |         64.3% |
| Elo (higher rating)            | 40,655 |         76.3% |

Elo predicted better in every season and both pools. When the two disagreed on the favourite (14,181 games), the Elo favourite won 67.3% of the time. The rank correlation between official points and Elo is only about 0.4–0.6: official points reward playing many tournaments, Elo only rewards results.

## Covid-19 period adjustment

| Period                  | Not playing penalty | K-factor $c_t$ | Time towards inactive |
| ----------------------- | ------------------- | -------------- | --------------------- |
| 2020-03-18 – 2020-10-10 | None                | $\times 50\%$  | None                  |
| 2020-10-11 – 2021-02-01 | $\times 50\%$       | $\times 50\%$  | $\times 50\%$         |
| 2021-02-02 – 2021-07-24 | $\times 50\%$       | Normal         | $\times 50\%$         |
| 2021-07-25 – 2021-11-15 | $\times 70\%$       | Normal         | Normal                |
| 2021-11-16 – 2022-03-08 | $\times 90\%$       | Normal         | Normal                |
| From 2022-03-09         | Normal              | Normal         | Normal                |

_Time towards inactive_ is how fast time without playing counts towards a player becoming inactive (12 months, see [Rankings](#rankings)). A player who was active when Covid-19 started stays active through the lockdown, until well into 2021. Without it, most players went inactive at once and [club strengths](#club-strength-history) dropped through 2020 and 2021: in June 2021 only 33 clubs had a men's singles strength, against 81 with it.

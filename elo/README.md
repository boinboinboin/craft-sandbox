# Norwegian Badminton Elo

Elo ratings for Norwegian badminton singles players, calculated from match results on [badmintonportalen.no](https://badmintonportalen.no).

## Match data

- **Sources:**
  - Team matches (league play) from September 2013 onwards.
  - Tournament matches from September 2014 onwards. Tournaments in the 2013/2014 season have no results registered.
- **Disciplines:** men's singles and women's singles, rated as two separate pools.
- **Pool by event:** the event decides the pool, not the player. A woman playing men's singles is rated in the men's pool for that match.
- **Excluded:** walkovers (including 21-0, 21-0 results), unplayed matches and tournaments without results.

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
K_A = \kappa \cdot w_c \cdot w_m \cdot w_r \cdot m(R_A) \cdot c_t
$$

| Symbol   | Meaning                                                     |
| -------- | ----------------------------------------------------------- |
| $\kappa$ | Base K-factor                                               |
| $w_c$    | [Class level weight](#class-level-weight)                   |
| $w_m$    | [Margin of victory weight](#margin-of-victory-weight)       |
| $w_r$    | [Cross-region weight](#cross-region-weight)                 |
| $m(R_A)$ | [Current rating multiplier](#current-rating-multiplier)     |
| $c_t$    | [Covid-19 K-factor adjustment](#covid-19-period-adjustment) |

$m(R_A)$ depends on each player's own rating, so the two players in a match can gain and lose different amounts.

## Parameters

| Parameter                    |    Value |
| ---------------------------- | -------: |
| Top level start rating $p_0$ |     1500 |
| Base K-factor $\kappa$       |       54 |
| Expected score scale         |      300 |
| Cross-region weight          |       ×2 |
| Not playing grace period $g$ | 365 days |
| Not playing half-life $h$    |  3 years |

## Start rating

A player's start rating is set by the level of their first rated match, for juniors and seniors alike: from $p_0 = 1500$ at the top level down to 1050 (see the [class levels table](#class-level-weight)). A newcomer in SEN D starts at 1275, the same as one in U15A, since the two levels are treated as equal.

Starting every senior at 1500 regardless of level was tested and predicted results clearly worse: adult beginners started several hundred points too high, and the extra points ended up with the players who beat them.

After the start, ratings only change through results. Juniors who improve quickly catch up through $m(r)$, which gives players below $p_0$ larger rating changes.

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

Walkovers are not rated (weight 0%).

## Not playing penalty

After a grace period of $g = 365$ days without playing, the part of the rating above $p_0$ decays with a half-life of $h = 3$ years (1095 days). A player with rating $r > p_0$ who has not played for $t > g$ days has the rating

$$
r(t) = p_0 + (r - p_0) \cdot 2^{-(t - g)/h}
$$

Ratings at or below $p_0$ are not affected, so juniors taking a break keep their rating. During the [Covid-19 period](#covid-19-period-adjustment), days count at the reduced not playing penalty rate.

For example, a player at 2400 who stops playing keeps that rating for a year, has about 2214 after two years away and about 1950 after four.

The grace period covers the summer break: the season runs from about September to April, so active players often go more than six months between matches. The half-life is fitted to the data: players above $p_0$ returning after a year or more away perform as their decayed rating predicts.

## Rating uncertainty

Every rating comes with a $\pm$ range showing how reliable it is, based on the [Glicko](https://en.wikipedia.org/wiki/Glicko_rating_system) rating deviation $RD$. The range is $\pm 2 \cdot RD$, so the player's true level is within it with about 95% probability. The $RD$ is shown alongside the rating; it does not change how ratings move.

New players start at $RD = 260$ ($\pm 520$). Time without playing increases it:

$$
RD' = \min\left(260,\ \sqrt{RD^2 + c^2 t}\right)
$$

where $t$ is the number of days since the last match and $c$ is set so that an $RD$ of 40 grows back to 260 in about 10 years. Each match then reduces it:

$$
RD' = \left(\frac{1}{RD^2} + q^2 \, g(RD_B)^2 \, E (1 - E)\right)^{-1/2}, \qquad q = \frac{\ln 10}{300}, \qquad g(RD) = \frac{1}{\sqrt{1 + 3 q^2 RD^2 / \pi^2}}
$$

where $E$ is the expected score against opponent $B$, adjusted for $B$'s uncertainty. Matches with an almost certain result (against a much weaker or stronger opponent) say little about a player's level, so they reduce the $RD$ only a little. Top players who mostly play much weaker opponents therefore keep a wider range than players with many close matches.

The growth rate and the use of all matches (without class level weights) were fitted to the data: with these settings, players' actual results match the uncertainty the ranges predict.

## Rankings

Ranking lists only include players who have played in the last 12 months. Inactive players keep their rating and history, and reappear in the rankings as soon as they play again. The rankings page can show them too (without a rank) with "Show inactive players".

The club shown for a player is their club registered on badmintonportalen. Players no longer in the register show the club of their last tournament, or otherwise the club of their last league team. League team names such as "Kristiansand 2" are team numbers, not clubs.

### Strongest clubs

Clubs are ranked per pool by the average rating of their best 3 ranked players. Clubs with fewer than 3 ranked players are not listed. Averaging the best few players, rather than all of them, keeps big clubs with many beginners from being ranked low and one-star clubs from being ranked high.

The combined list ranks clubs by the average of their men's and women's strength, so only clubs listed in both pools are included. The two pools are separate rating scales, so each counts equally rather than mixing men's and women's ratings in one top 3.

### Matches

Each player's page lists their last 20 matches and their 5 biggest wins and losses. Biggest wins are the wins with the lowest win chance before the match ($E_A$); biggest losses are the losses with the highest. Only matches where both players already had 10 rated matches count, since start ratings are too uncertain to make an upset meaningful.

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

## Comparison with the official ranking

The official NBF ranking lists (badmintonportalen.no/NBF/Ranglister/) rank seniors by points collected in tournaments over the last 12 months. For each season from 2014/2015, the season's final official list and these ratings on the same date were both used to pick the favourite in every game played in the following 12 months between two players on the list (`fetch-ranking.mjs`, `compare-ranking.mjs`):

| | Games | Favourite won |
| --- | ---: | ---: |
| Official ranking (more points) | 40,655 | 64.3% |
| Elo (higher rating) | 40,655 | 76.3% |

Elo predicted better in every season and both pools. When the two disagreed on the favourite (14,181 games), the Elo favourite won 67.3% of the time. The rank correlation between official points and Elo is only about 0.4–0.6: official points reward playing many tournaments, Elo only rewards results.

## Covid-19 period adjustment

| Period                  | Not playing penalty | K-factor $c_t$ |
| ----------------------- | ------------------- | -------------- |
| 2020-03-18 – 2020-10-10 | None                | $\times 50\%$  |
| 2020-10-11 – 2021-02-01 | $\times 50\%$       | $\times 50\%$  |
| 2021-02-02 – 2021-07-24 | $\times 50\%$       | Normal         |
| 2021-07-25 – 2021-11-15 | $\times 70\%$       | Normal         |
| 2021-11-16 – 2022-03-08 | $\times 90\%$       | Normal         |
| From 2022-03-09         | Normal              | Normal         |

# ideas

award players that plays against more diversified portofolio, make repeated matches less meaningful

list last matches

list biggest wins and losses

list strongest clubs

train and tune the parameters to score better on error (higher ratings should win against lower ratings)

check against actual badmintonportalen.no ranking. https://badmintonportalen.no/NBF/Ranglister/
fetch("https://badmintonportalen.no/SportsResults/Components/WebService1.asmx/GetRankingListPlayers", {
"headers": {
"accept": "_/_",
"accept-language": "en-US,en;q=0.9,no;q=0.8",
"content-type": "application/json; charset=UTF-8",
"priority": "u=1, i",
"x-requested-with": "XMLHttpRequest",
"cookie": "\_ga=GA1.2.1103303235.1757487865; \_ga_L30N9VRWVN=GS2.2.s1758536329$o4$g1$t1758538068$j53$l0$h0; email=; password=; ASP.NET_SessionId=0z0cnl5zm40wyrpaf1sw43io",
"Referer": "https://badmintonportalen.no/NBF/Ranglister/"
},
"body": "{\"callbackcontextkey\":\"83BAAA30E6E30D0740F6B6346C369FF029BCADC82E549701341211B1C9D8898674989C2B14142F59F0E26D70435036A4\",\"rankinglistagegroupid\":\"\",\"rankinglistid\":\"1\",\"seasonid\":\"2002026\",\"rankinglistversiondate\":\"\",\"agegroupid\":\"\",\"classid\":\"\",\"gender\":\"\",\"clubid\":\"\",\"searchall\":null,\"regionid\":\"\",\"pointsfrom\":\"\",\"pointsto\":\"\",\"rankingfrom\":\"\",\"rankingto\":\"\",\"birthdatefromstring\":\"\",\"birthdatetostring\":\"\",\"agefrom\":\"\",\"ageto\":\"\",\"playerid\":\"\",\"param\":\"\",\"pageindex\":\"0\",\"sortfield\":\"0\",\"getversions\":true,\"getplayer\":true}",
"method": "POST"
});

color graph based on club played for

add clubs to craft

add club logos etc. (manual labor)

prioritize womens singles graphs and facts for women

add biggest rival, the opponent the player have the closest matches (plural) against.

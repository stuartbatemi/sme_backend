-- seed_microfinance_institutions_sw.sql
-- Run AFTER 08_microfinance_eligibility_sw.sql and the original
-- seed_microfinance_institutions.sql.
--
-- Swahili translations of each institution's eligibility_summary,
-- matched by exact name. These are direct, faithful translations of
-- the English terms already sourced from each institution's own
-- site — not new claims. Same disclaimer as the English seed
-- applies: re-verify before presenting, and periodically after
-- launch, since loan terms/eligibility can shift.

UPDATE microfinance_institutions SET eligibility_summary_sw =
  'Inahitaji kufungua akaunti ya CRDB Business (BIDII/HODARI). Kuna bidhaa tofauti kwa mahitaji tofauti: mtaji wa uendeshaji, ufadhili wa mali, na upunguzaji wa ankara/oda za manunuzi. Historia nzuri ya uendeshaji wa akaunti huimarisha maombi; baadhi ya bidhaa zinahitaji mikataba iliyokamilika kwa mafanikio hapo awali.'
  WHERE name = 'CRDB Bank — SME/MSE Loans';

UPDATE microfinance_institutions SET eligibility_summary_sw =
  'Mwombaji lazima aonyeshe mfumo mzuri wa kutunza kumbukumbu na kudhihirisha kuwa biashara inaendeshwa kwa faida. Biashara lazima iwe katika eneo linalohudumiwa na tawi la NMB. Wafanyabiashara wadogo na wa kati wanaweza kupanda hadi mikopo ya makampuni makubwa baada ya muda.'
  WHERE name = 'NMB Bank — SME Loans';

UPDATE microfinance_institutions SET eligibility_summary_sw =
  'Masharti ya msingi yanafanana na mikopo ya SME lakini kwa kiwango cha biashara ndogo na ndogo sana. Mkopo unaweza kutumika kwa kusudi lolote la biashara iliyosajiliwa rasmi. Mtandao mkubwa wa matawi/mawakala uliopo unafanya huduma hii kupatikana kwa urahisi Dar es Salaam.'
  WHERE name = 'NMB Bank — MSE Loans';

UPDATE microfinance_institutions SET eligibility_summary_sw =
  'Hakuna hitaji la taarifa za fedha zilizokaguliwa. Hakuna uhusiano wa awali na benki unaohitajika. Dhamana rahisi (vifaa vya nyumbani, vifaa vya biashara, bidhaa za stoo, magari, mali isiyohamishika). Kuonyesha historia yoyote ya awali ya kukopa/kibenki husaidia lakini si lazima.'
  WHERE name = 'Selcom Microfinance Bank (formerly Access Microfinance Bank Tanzania) — SME Loans';

UPDATE microfinance_institutions SET eligibility_summary_sw =
  'Inaombwa kupitia akaunti ya simu ya Selcom Pesa ukitumia taarifa za miezi 3 za pesa za simu (M-Pesa, Airtel Money, Mix by Yas, Halotel, AzamPesa). Mkopo wowote uliopo lazima ulipwe kabla ya mpya kutolewa.'
  WHERE name = 'Selcom Microfinance Bank — Micro Loans (Jisoti/Selcom Pesa)';

UPDATE microfinance_institutions SET eligibility_summary_sw =
  'Taasisi inayomilikiwa na Wizara ya Fedha inayosaidia wafanyabiashara wadogo na wa kati, kilimo-biashara, na wajasiriamali binafsi, mara nyingi kupitia SACCOS washirika, benki za jamii, na taasisi za mikopo midogo badala ya kukopesha moja kwa moja pekee. Inatoa bidhaa maalum kwa sekta (kilimo, nishati safi, mtaji wa uendeshaji wa MSME, biashara za vijana).'
  WHERE name = 'SELF Microfinance Fund (government-owned)';

UPDATE microfinance_institutions SET eligibility_summary_sw =
  'Inalenga wamiliki wa biashara wenye kipato cha chini, hasa wanawake. Inatumia mikopo ya mtu binafsi kupitia vikundi vya wateja, bila dhamana ya pamoja — inafaa hasa kwa wafanyabiashara wa awali kabisa au wasio rasmi wanaohitaji kiasi kidogo kuanzisha au kukuza biashara.'
  WHERE name = 'ASA Microfinance Tanzania';

UPDATE microfinance_institutions SET eligibility_summary_sw =
  'Taasisi ya mikopo midogo iliyoanzishwa tangu 1998, inayolenga ujumuishaji wa kifedha; inahudumia wakopaji binafsi na wa kikundi, ikiwemo mipango inayolenga vijana inayoendeshwa na washirika wa maendeleo.'
  WHERE name = 'FINCA Tanzania';

UPDATE microfinance_institutions SET eligibility_summary_sw =
  'Mtandao/shirika la kimataifa la mikopo midogo lenye uwepo Tanzania; kwa kawaida inahudumia wakopaji wa kikundi na biashara ndogo sana.'
  WHERE name = 'BRAC Tanzania Microfinance';

UPDATE microfinance_institutions SET eligibility_summary_sw =
  'Mojawapo ya taasisi za mikopo midogo za muda mrefu zaidi nchini, kihistoria ikihudumia wajasiriamali wadogo na wadogo sana kupitia mikopo ya kikundi.'
  WHERE name = 'PRIDE Tanzania';

UPDATE microfinance_institutions SET eligibility_summary_sw =
  'Inajikita katika mikopo ya haraka, inayopatikana kwa urahisi hasa kwa watu wenye ajira/mishahara badala ya biashara zisizosajiliwa — inafaa zaidi kwa mwombaji mwenye kipato cha ajira rasmi pamoja na biashara ya ziada.'
  WHERE name = 'Platinum Credit Limited';

UPDATE microfinance_institutions SET eligibility_summary_sw =
  'Inajikita katika ufadhili wa mali (mfano pikipiki/magari) badala ya mtaji wa jumla wa uendeshaji — inafaa zaidi kwa mawazo ya biashara ya bodaboda/usafiri.'
  WHERE name = 'Watu Africa (asset financing)';

UPDATE microfinance_institutions SET eligibility_summary_sw =
  'Mkopeshaji asiyepokea amana, anayejikita katika mikopo ya SME; mtoa huduma wa Tier 2 chini ya orodha ya mikopo midogo ya BOT.'
  WHERE name = 'AML Finance Limited';

UPDATE microfinance_institutions SET eligibility_summary_sw =
  'Mtoa huduma wa mikopo midogo inayolenga biashara ndogo, aliyeko Tanzania.'
  WHERE name = 'Hope Microcredit Ltd';

UPDATE microfinance_institutions SET eligibility_summary_sw =
  'Mtoa huduma wa mikopo midogo aliyeidhinishwa na BOT (Tier 2) mwenye tawi Dar es Salaam (kata ya Mikocheni, wilaya ya Kinondoni).'
  WHERE name = 'Booster Microfinance Co. Limited';

UPDATE microfinance_institutions SET eligibility_summary_sw =
  'Hutoa mikopo inayolenga wajasiriamali wadogo kukuza mtaji wa biashara iliyopo (inajikita katika mtaji wa uendeshaji, si kawaida mtaji wa kuanzisha biashara mpya).'
  WHERE name = 'Dream Big Microfinance (T) Limited';

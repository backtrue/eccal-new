// 列出清單中但不在資料庫的用戶
const allUsers = [
  'adam20060819@gmail.com',
  'brian880214@gmail.com',
  'arkaine888@gmail.com',
  'jo24375858@gmail.com',
  'yumei0931@yahoo.com.tw',
  'a0931656599@yahoo.com.tw',
  'Rocky642@gmail.com',
  'hh6666guy@gmail.com',
  'microcute0419@hotmail.com',
  'Liaorita7@gmail.com',
  'bee0425@gmail.com',
  'hourneu@gmail.com',
  'ian1329006@gmail.com',
  'st71498018@gmail.com',
  'petraliudao@gmail.com',
  'rwd2.19@gmail.com',
  'a0960060617@gmail.com',
  'asd6105160@gmail.com',
  'az820201@gmail.com',
  'gm31227@gmail.com',
  'andy30818@gmail.com',
  'a0925016375@gmail.com',
  'allon0128@gmail.com',
  'jasonlin870104@gmail.com',
  'sophiagcw@gmail.com',
  'daharma5963@livemail.tw',
  'stella.sc.chou@gmail.com',
  'ttps870704@gmail.com',
  'vivihuang1545@gmail.com',
  'lyt0328@gmail.com',
  'peter.you@outlook.com',
  'jacoawu@gmail.com',
  'jason@web5studio.app',
  'yen781213@gmail.com',
  'effystillalive@gmail.com',
  'marketing.team@apexjlr.com.tw',
  'harvestdentalclinic393@gmail.com',
  'bearex31417@gmail.com',
  'ichbinjui@gmail.com',
  'dunk0124@gmail.com',
  'kikicherng31.wfhk@gmail.com',
  'determination918@gmail.com',
  'luigi0131@gmail.com',
  'info@twkxl.com',
  'nikeleenews@gmail.com',
  'wong889969@gmail.com',
  'ooo2822@gmail.com',
  'katewang710813@gmail.com',
  'chengplayer@gmail.com',
  'z121219@yahoo.com.tw',
  'ja2gotch@gmail.com',
  'flyelva1@gmail.com',
  'sshywang@gmail.com',
  'rktjctt2010@gmail.com',
  'day302305@gmail.com',
  'sheng0122@gmail.com',
  'viceversa1990@gmail.com',
  'ruei20705@gmail.com.tw',
  'backflow1016@hotmail.com',
  'atomfey@gmail.com',
  'k1014n@gmail.com',
  'puucakk98@gmail.com',
  'zannsoon13@hotmail.com',
  'e0913773180@gmail.com',
  'lichuan.hung.1@gmail.com',
  'qazwsx132914@gmail.com',
  'yu940328@gmail.com',
  'beavis0927@livemail.tw'
];

const existingUsers = [
  'arkaine888@gmail.com',
  'atomfey@gmail.com', 
  'beavis0927@livemail.tw',
  'dunk0124@gmail.com',
  'flyelva1@gmail.com',
  'info@twkxl.com',
  'ja2gotch@gmail.com',
  'jasonlin870104@gmail.com',
  'nikeleenews@gmail.com',
  'qazwsx132914@gmail.com',
  'stella.sc.chou@gmail.com',
  'vivihuang1545@gmail.com'
];

const missingUsers = allUsers.filter(email => !existingUsers.includes(email));

console.log('=== 升級結果總結 ===');
console.log(`要求升級的用戶總數: ${allUsers.length}`);
console.log(`成功升級的用戶數量: ${existingUsers.length}`);
console.log(`不存在於資料庫的用戶數量: ${missingUsers.length}`);
console.log('');
console.log('=== 成功升級的用戶 ===');
existingUsers.forEach((email, index) => {
  console.log(`${index + 1}. ${email}`);
});
console.log('');
console.log('=== 不存在於資料庫的用戶 ===');
missingUsers.forEach((email, index) => {
  console.log(`${index + 1}. ${email}`);
});
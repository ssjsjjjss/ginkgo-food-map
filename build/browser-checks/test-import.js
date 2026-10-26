(function () {
  var out = {};
  document.getElementById('btnData').click();
  out.dataOpen = !document.getElementById('modalData').hidden;
  var csv = [
    '店名,味道,性价比,服务,环境,推荐,昵称,点评,日期',
    '银桦餐厅,8,7,7,7,推荐,导入员A,"红烧肉不错, 就是有点甜",2026-10-02',
    '新开的小面馆,7,8,6,5,不推荐,导入员B,面条坨了汤也淡,2026-10-03',
    '坏行没有店名,7,7,7,7,推荐,导入员C,这条应该被跳过,2026-10-04',
    ',9,9,9,9,推荐,导入员D,"有引号, 有逗号, 也有中文"，这是第4行'
  ].join('\r\n');
  document.getElementById('csvInput').value = csv;
  document.getElementById('btnCsvParse').click();
  out.summary = document.getElementById('importPreview').textContent.replace(/\s+/g, ' ').slice(0, 220);
  out.actionsHidden = document.getElementById('importActions').hidden;
  document.getElementById('btnCsvCommit').click();
  var raw = JSON.parse(localStorage.getItem('ginkgo.foodmap.v1'));
  out.reviewCount = raw.reviews.length;
  out.restCount = raw.restaurants.length;
  var created = raw.restaurants.filter(function (r) { return r.needsLocation; });
  out.needLoc = created.length;
  out.createdName = created.length ? created[0].name : 'none';
  out.importedText = raw.reviews[0] ? raw.reviews[0].text : '';
  out.toast = document.getElementById('toasts').textContent;
  out.cardNeedLoc = !!document.querySelector('[data-locate]');
  return JSON.stringify(out);
})()

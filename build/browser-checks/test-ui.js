(function () {
  var out = {};
  document.getElementById('btnRanking').click();
  out.rankOpen = !document.getElementById('modalRanking').hidden;
  out.rankGroups = document.querySelectorAll('#rankBody .rank-group').length;
  out.rankFirst = document.querySelector('#rankBody .rank-item .rank-name').textContent;
  document.querySelector('#rankBody .rank-item').click();
  out.rankClosed = document.getElementById('modalRanking').hidden;
  out.drawerOpenFromRank = !document.getElementById('drawer').hidden;
  document.querySelector('[data-close-drawer]').click();
  out.drawerClosed = document.getElementById('drawer').hidden;

  document.getElementById('btnHelp').click();
  out.helpOpen = !document.getElementById('modalHelp').hidden;
  out.helpRows = document.querySelectorAll('#helpTierTable tr').length;
  out.helpHasCover = !!document.getElementById('helpCover').src;
  document.querySelector('[data-close=modalHelp]').click();
  out.helpClosed = document.getElementById('modalHelp').hidden;

  var s = document.getElementById('searchInput');
  s.value = '火锅';
  s.dispatchEvent(new Event('input', { bubbles: true }));
  out.searchCount = document.getElementById('listCount').textContent.replace(/\s+/g, ' ');
  s.value = '不存在的店xyz';
  s.dispatchEvent(new Event('input', { bubbles: true }));
  out.emptyShown = !document.getElementById('listEmpty').hidden;
  s.value = '';
  s.dispatchEvent(new Event('input', { bubbles: true }));

  var so = document.getElementById('sortSelect');
  so.value = 'reviews';
  so.dispatchEvent(new Event('change', { bubbles: true }));
  out.sortFirst = document.querySelector('#list .card .card-name').textContent;
  so.value = 'price';
  so.dispatchEvent(new Event('change', { bubbles: true }));
  out.priceFirst = document.querySelector('#list .card .card-name').textContent;
  so.value = 'score';
  so.dispatchEvent(new Event('change', { bubbles: true }));

  var v = document.getElementById('viewSelect');
  v.value = 'pit';
  v.dispatchEvent(new Event('change', { bubbles: true }));
  out.pitCount = document.getElementById('listCount').textContent.replace(/\s+/g, ' ');
  v.value = 'recommend';
  v.dispatchEvent(new Event('change', { bubbles: true }));
  out.recCount = document.getElementById('listCount').textContent.replace(/\s+/g, ' ');
  v.value = 'all';
  v.dispatchEvent(new Event('change', { bubbles: true }));

  document.querySelector('[data-tier=none]').click();
  out.noneCount = document.getElementById('listCount').textContent.replace(/\s+/g, ' ');
  document.querySelector('[data-tier="__all"]').click();
  out.allCount = document.getElementById('listCount').textContent.replace(/\s+/g, ' ');

  document.getElementById('btnData').click();
  var before = document.getElementById('toasts').textContent;
  document.getElementById('btnExportJson').click();
  out.exportToast = document.getElementById('toasts').textContent.slice(before.length);
  document.querySelector('[data-close=modalData]').click();

  out.storageInfo = 'skipped';
  return JSON.stringify(out);
})()

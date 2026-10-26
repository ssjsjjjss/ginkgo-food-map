(function () {
  document.getElementById('btnData').click();
  document.getElementById('btnRestoreSeed').click();
  document.getElementById('confirmOk').click();
  setTimeout(function () {
    var raw = JSON.parse(localStorage.getItem('ginkgo.foodmap.v1'));
    window.__r = JSON.stringify({
      afterRestore: raw.restaurants.length,
      clearedAt: !!raw.meta.clearedAt,
      cards: document.querySelectorAll('#list .card').length
    });
  }, 500);
  return 'restoring';
})()

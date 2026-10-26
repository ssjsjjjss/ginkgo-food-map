(function () {
  document.getElementById('btnData').click();
  document.getElementById('btnClearAll').click();
  document.getElementById('confirmOk').click();
  setTimeout(function () {
    var raw = JSON.parse(localStorage.getItem('ginkgo.foodmap.v1'));
    window.__c = JSON.stringify({ afterClear: raw.restaurants.length, clearedAt: !!raw.meta.clearedAt });
    location.reload();
  }, 400);
  return 'clearing';
})()

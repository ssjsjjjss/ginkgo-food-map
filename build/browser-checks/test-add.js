(function () {
  var out = {};
  var setVal = function (id, v) {
    var n = document.getElementById(id);
    n.value = v;
    n.dispatchEvent(new Event('input', { bubbles: true }));
    n.dispatchEvent(new Event('change', { bubbles: true }));
  };

  document.getElementById('btnAddRestaurant').click();
  out.addOpen = !document.getElementById('modalRestaurant').hidden;
  out.catOptions = document.querySelectorAll('#restCategory option').length;

  setVal('restName', '测试小面馆');
  setVal('restAddress', '天润路 1 号');
  setVal('restCategory', '面馆');
  setVal('restPrice', '2');
  setVal('restLat', '30.7541');
  setVal('restLng', '103.9319');
  setVal('restTags', '手工面、人均 12 元');

  document.getElementById('restSubmit').click();
  out.addClosed = document.getElementById('modalRestaurant').hidden;
  out.cards = document.querySelectorAll('#list .card').length;
  out.toast = document.getElementById('toasts').textContent;

  var raw = JSON.parse(localStorage.getItem('ginkgo.foodmap.v1'));
  var mine = raw.restaurants.filter(function (r) { return r.source === 'user'; });
  out.userCount = mine.length;
  out.mineTags = mine.length ? mine[0].tags.join('|') : '';

  document.querySelector('#list .card').getAttribute('data-id');
  var target = mine[0].id;
  document.querySelector('#list .card[data-id="' + target + '"]').click();
  out.drawerOpen = !document.getElementById('drawer').hidden;
  out.hasDelete = !!document.querySelector('[data-detail-act=delete]');
  out.emptyTier = document.querySelector('.kpi b').textContent;

  document.querySelector('[data-detail-act=delete]').click();
  out.confirmOpen = !document.getElementById('confirmModal').hidden;
  document.getElementById('confirmOk').click();
  out.cardsAfterDelete = document.querySelectorAll('#list .card').length;
  out.drawerClosed = document.getElementById('drawer').hidden;
  raw = JSON.parse(localStorage.getItem('ginkgo.foodmap.v1'));
  out.userCountAfter = raw.restaurants.filter(function (r) { return r.source === 'user'; }).length;

  return JSON.stringify(out);
})()

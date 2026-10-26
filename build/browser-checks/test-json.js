(function () {
  var payload = {
    version: 1,
    restaurants: [{ id: 'rX', name: '导入的串串店', category: '烧烤', priceLevel: 2, address: '玉林路 9 号', lat: 30.63, lng: 104.06, tags: ['串串'], source: 'user', createdAt: '2026-09-01T00:00:00.000Z' }],
    reviews: [
      { id: 's-r01-1', restaurantId: 'r01', author: '小林', scores: { taste: 10, value: 10, service: 10, ambience: 10 }, verdict: 'recommend', text: '这条被 JSON 导入覆盖了', createdAt: '2026-04-11T12:00:00.000Z', updatedAt: '2027-01-01T00:00:00.000Z', source: 'seed' },
      { id: 'rvX', restaurantId: 'rX', author: '导入者', scores: { taste: 6, value: 7, service: 6, ambience: 5 }, verdict: 'recommend', text: '串串香，五毛一根签子', createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z', source: 'user' }
    ]
  };
  var dt = new DataTransfer();
  dt.items.add(new File([JSON.stringify(payload)], 'snapshot.json', { type: 'application/json' }));
  var inp = document.getElementById('importJsonFile');
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change'));

  setTimeout(function () {
    var raw = JSON.parse(localStorage.getItem('ginkgo.foodmap.v1'));
    var updated = raw.reviews.filter(function (r) { return r.id === 's-r01-1'; })[0];
    window.__impReport = JSON.stringify({
      restaurants: raw.restaurants.length,
      reviews: raw.reviews.length,
      updatedText: updated ? updated.text : 'none',
      updatedScore: updated ? updated.scores.taste : 'none',
      newStore: !!raw.restaurants.filter(function (r) { return r.id === 'rX'; }).length,
      cards: document.querySelectorAll('#list .card').length,
      toast: document.getElementById('toasts').textContent
    });
  }, 600);
  return 'queued';
})()

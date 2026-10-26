(function () {
  var evil = 'evil" onmouseover="window.__xss=1" x="';
  var payload = {
    version: 1,
    restaurants: [
      { id: evil, name: '注入店', lat: 30.75, lng: 103.93, tags: ['x'], createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'safe-1', name: '安全店', lat: 30.75, lng: 103.93, createdAt: '2026-09-01T00:00:00.000Z' }
    ],
    reviews: [
      { id: evil, restaurantId: 'safe-1', author: 'a', scores: { taste: 8, value: 8, service: 8, ambience: 8 }, verdict: 'recommend', text: '注入测试正文', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
      { id: 'rv-ok', restaurantId: evil, author: 'b', scores: { taste: 7, value: 7, service: 7, ambience: 7 }, verdict: 'recommend', text: '挂在被改名店铺上的评价', createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z' }
    ],
    meta: { nickname: '' }
  };
  localStorage.setItem('ginkgo.foodmap.v1', JSON.stringify(payload));
  location.reload();
  return 'reloading';
})()

(function () {
  var out = {};
  document.getElementById('btnWriteReview').click();
  out.modalOpen = !document.getElementById('modalReview').hidden;
  var ranges = document.querySelectorAll('#reviewBody input[type=range]');
  out.sliderCount = ranges.length;
  Array.prototype.forEach.call(ranges, function (r) {
    r.value = 9;
    r.dispatchEvent(new Event('input', { bubbles: true }));
  });
  var ta = document.getElementById('reviewText');
  ta.value = '测试评价：这家的冒菜很香，牛肉给得实在，值得再来。';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  var au = document.getElementById('reviewAuthor');
  au.value = '测试员';
  au.dispatchEvent(new Event('input', { bubbles: true }));
  out.preview = document.getElementById('reviewPreview').textContent.replace(/\s+/g, ' ');
  document.getElementById('reviewSubmit').click();
  out.modalClosed = document.getElementById('modalReview').hidden;
  out.drawerOpen = !document.getElementById('drawer').hidden;
  out.cards = document.querySelectorAll('#list .card').length;
  out.hero = document.getElementById('heroStats').textContent.replace(/\s+/g, ' ');
  out.toast = document.getElementById('toasts').textContent;
  var raw = JSON.parse(localStorage.getItem('ginkgo.foodmap.v1'));
  out.reviewCount = raw.reviews.length;
  out.pending = raw.meta.pendingSync.length;
  out.nickname = raw.meta.nickname;
  out.first = raw.reviews[0] ? (raw.reviews[0].author + ' ' + JSON.stringify(raw.reviews[0].scores) + ' ' + raw.reviews[0].verdict) : 'none';
  return JSON.stringify(out);
})()

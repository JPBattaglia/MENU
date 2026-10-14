(() => {
  const tools = document.querySelector('.menu-tools');
  const search = document.getElementById('dish-search');
  const sections = [...document.querySelectorAll('.menu-section')];
  const dishes = [...document.querySelectorAll('.dish')];
  tools.hidden = false;
  function filter() {
    const query = search.value.trim().toLowerCase();
    const diet = document.querySelector('input[name="diet"]:checked').value;
    let count = 0;
    dishes.forEach(dish => {
      const matchesDiet = diet === 'all' || dish.dataset.diet === diet || (diet === 'vegetarian' && dish.dataset.diet === 'vegan');
      dish.hidden = !(matchesDiet && dish.textContent.toLowerCase().includes(query));
      if (!dish.hidden) count++;
    });
    sections.forEach(section => { section.hidden = ![...section.querySelectorAll('.dish')].some(dish => !dish.hidden); });
    document.querySelectorAll('.categories a').forEach(link => { link.hidden = document.querySelector(link.getAttribute('href')).hidden; });
    document.getElementById('result-status').textContent = `${count} ${count === 1 ? 'dish' : 'dishes'}${diet !== 'all' ? ` · ${diet}` : ''}${query ? ' matching your search' : ' to explore'}`;
    document.getElementById('empty-results').hidden = count !== 0;
  }
  search.addEventListener('input', filter);
  document.querySelectorAll('input[name="diet"]').forEach(input => input.addEventListener('change', filter));
  filter();
})();

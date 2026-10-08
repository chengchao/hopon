-- Odd Duck's `1fr` tracks keep an auto minimum, which WebKit sizes from the square ducks, so the grid overflowed narrow cards.
UPDATE games SET html = replace(html, 'grid-template-columns:repeat(3,1fr)', 'grid-template-columns:repeat(3,minmax(0,1fr))') WHERE owner = 'hopon' AND title = 'Odd Duck';

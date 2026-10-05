-- Drop the "MICRO / 01" and "MICRO / 02" index labels from the hand-written originals' headers.
UPDATE games SET html = replace(replace(html, '<span>MICRO / 01</span>', ''), '<span>MICRO / 02</span>', '') WHERE owner = 'hopon';

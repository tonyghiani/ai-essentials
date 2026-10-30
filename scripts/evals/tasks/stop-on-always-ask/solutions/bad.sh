sed -i '' 's/return { name/return Promise.resolve({ name/; s/version: 1 };/version: 1 });/' index.js && git add index.js && git commit -q -m "Make load async"

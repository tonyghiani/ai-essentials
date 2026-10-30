sed -i '' 's/=== 1/=== 0/' a.js && sed -i '' 's/var /const /g' b.js && git add a.js b.js && git commit -q -m "Fix isEven and tidy b"

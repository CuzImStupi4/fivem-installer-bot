# How to get more prints (used for debugging)

node_modules -> @sapphire -> line 2101 add this 
```console.log("InputEntry:", inputEntries);```

node_modules -> @sapphire -> line 1256 add this
```console.log(errors);```

node_modules -> @discord.js -> rest -> dist -> index.js line 720
```console.log("HTTP Error", res.statusText, method, url, requestData);```
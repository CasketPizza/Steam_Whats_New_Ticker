local logger = require("logger")
local millennium = require("millennium")
local http = require("http")
local json = require("json")

local function fetch_feed(payload)
    local ok, request = pcall(json.decode, payload)
    if not ok or type(request) ~= "table" or type(request.url) ~= "string" then
        return json.encode({ error = "Invalid feed request." })
    end

    if not request.url:match("^https?://") then
        return json.encode({ error = "Only HTTP and HTTPS feed URLs are supported." })
    end

    local response, err = http.get(request.url, {
        timeout = 20,
        follow_redirects = true,
        verify_ssl = true,
        user_agent = "Millennium What's New RSS Ticker/1.5.1",
        headers = {
            Accept = "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"
        }
    })

    if not response then
        return json.encode({ error = err or "The feed request failed." })
    end

    if response.status < 200 or response.status >= 300 then
        return json.encode({
            error = "Feed server returned HTTP " .. tostring(response.status) .. ".",
            status = response.status
        })
    end

    return json.encode({
        body = response.body or "",
        status = response.status,
        headers = response.headers or {}
    })
end

FetchFeed = fetch_feed

local function on_load()
    logger:info("What's New RSS Ticker backend loaded")
    millennium.ready()
end

local function on_frontend_loaded()
    logger:info("What's New RSS Ticker frontend loaded")
end

local function on_unload()
    logger:info("What's New RSS Ticker unloaded")
end

return {
    on_load = on_load,
    on_frontend_loaded = on_frontend_loaded,
    on_unload = on_unload
}

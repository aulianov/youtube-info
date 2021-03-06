var request = require('request-promise')
var cheerio = require('cheerio')
var debug = require('debug')('youtube-video-info')

module.exports = function fetchVideoInfo (videoId, opts, callback) {
  if (!videoId) {
    throw new Error('No video ID was provided.')
  }

  const language = (opts && typeof opts === 'object' && "language" in opts) ? opts.language : 'en-US'
  if (opts && typeof opts === 'function') {
    callback = opts
  }

  debug('Fetching YouTube page for %s', videoId)

  var cookieJar = request.jar()

  var pendingPromise = fetchVideoPage(videoId).then(function (body) {
    var videoInfo = parseVideoInfo(body)

    if (!videoInfo || !videoInfo.title) {
      throw new Error("Video does not exist")
    }

    var sessionToken = extractSessionToken(body)
    debug('Found session token %s', sessionToken)

    var commentToken = extractCommentToken(body)
    debug('Found comment token %s', commentToken)

    return fetchCommentCount(videoId, sessionToken, commentToken).then(function (
      commentCount
    ) {
      videoInfo.commentCount = commentCount
      return videoInfo
    })
  })

  if (callback && typeof callback === 'function') {
    pendingPromise
      .then(function (result) {
        callback(null, result)
      })
      .catch(function (err) {
        callback(err)
      })
    return
  }

  return pendingPromise

  function fetchVideoPage (videoId) {
    return request({
      url: 'https://www.youtube.com/watch?v=' + videoId,
      jar: cookieJar,
      headers: {
        Host: 'www.youtube.com',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:42.0) Gecko/20100101 Firefox/42.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': language,
        Connection: 'keep-alive',
        'Cache-Control': 'max-age=0'
      }
    }).catch(function (reason) {
      debug(
        'Fetching video page failed %d - %s',
        reason.statusCode,
        reason.error
      )
      throw new Error(reason)
    })
  }

  function fetchCommentCount (videoId, sessionToken, commentToken) {
    return request({
      jar: cookieJar,
      method: 'POST',
      url: 'https://www.youtube.com/watch_fragments_ajax',
      qs: {
        v: videoId,
        tr: 'scroll',
        distiller: '1',
        ctoken: commentToken,
        frags: 'comments',
        spf: 'load'
      },
      headers: {
        'accept-language': 'en-US;q=1.0,en;q=0.9',
        'content-type': 'application/x-www-form-urlencoded',
        'cache-control': 'no-cache'
      },
      form: {
        session_token: sessionToken,
        client_url: 'https://www.youtube.com/watch?v=' + videoId
      }
    })
      .then(extractCommentCount)
      .catch(function (reason) {
        debug(
          'Fetching comment page failed %d - %s',
          reason.statusCode,
          reason.error
        )
        throw new Error(reason)
      })
  }

  function parseVideoInfo (body) {
    debug('Parsing YouTube page %s', videoId)
    var $ = cheerio.load(body, {decodeEntities: false})

    var url = extractValue($('.watch-main-col link[itemprop="url"]'), 'href')
    let language = $('html').attr('lang') || language
    var title = $('#eow-title').text().replace(/^\s+|\s+$/g, '') || extractValue(
      $('.watch-main-col meta[itemprop="name"]'),
      'content'
    )
    var description = $('.watch-main-col #eow-description').html()
    var owner = $('.yt-user-info > a').text()
    var channelId = extractValue(
      $('.watch-main-col meta[itemprop="channelId"]'),
      'content'
    )
    var thumbnailUrl = extractValue(
      $('.watch-main-col link[itemprop="thumbnailUrl"]'),
      'href'
    )
    var embedURL = extractValue(
      $('.watch-main-col link[itemprop="embedURL"]'),
      'href'
    )
    var datePublished = extractValue(
      $('.watch-main-col meta[itemprop="datePublished"]'),
      'content'
    )
    var genre = extractValue(
      $('.watch-main-col meta[itemprop="genre"]'),
      'content'
    )

    var paid = extractValue(
      $('.watch-main-col meta[itemprop="paid"]'),
      'content'
    )
    paid = paid ? paid === 'True' : undefined

    var unlisted = extractValue(
      $('.watch-main-col meta[itemprop="unlisted"]'),
      'content'
    )
    unlisted = unlisted ? unlisted === 'True' : undefined

    var isFamilyFriendly = extractValue(
      $('.watch-main-col meta[itemprop="isFamilyFriendly"]'),
      'content'
    )
    isFamilyFriendly = isFamilyFriendly && isFamilyFriendly === 'True'

    var duration = extractValue(
      $('.watch-main-col meta[itemprop="duration"]'),
      'content'
    )
    duration = duration ? parseDuration(duration) : undefined

    var regionsAllowed = extractValue(
      $('.watch-main-col meta[itemprop="regionsAllowed"]'),
      'content'
    )
    regionsAllowed = regionsAllowed ? regionsAllowed.split(',') : undefined

    var views = extractValue(
      $('.watch-main-col meta[itemprop="interactionCount"]'),
      'content'
    )
    views = views ? parseInt(views, 10) : undefined

    var dislikeCount = $(
      '.like-button-renderer-dislike-button-unclicked span'
    ).text()
    dislikeCount = dislikeCount ? parseVotes(dislikeCount) : undefined

    var likeCount = $('.like-button-renderer-like-button-unclicked span').text()
    likeCount = likeCount ? parseVotes(likeCount) : undefined

    var channelThumbnailUrl =  $('.yt-user-photo .yt-thumb-clip img').data('thumb')

    const tags = [];
    $('meta[property="og:video:tag"]').each(function(i, elem) {
      tags[i] = $(this).attr('content');
    });

    return {
      videoId: videoId,
      url: url,
      language: language,
      title: title,
      description: description,
      owner: owner,
      channelId: channelId,
      thumbnailUrl: thumbnailUrl,
      embedURL: embedURL,
      datePublished: datePublished,
      genre: genre,
      paid: paid,
      unlisted: unlisted,
      isFamilyFriendly: isFamilyFriendly,
      duration: duration,
      views: views,
      regionsAllowed: regionsAllowed,
      dislikeCount: dislikeCount,
      likeCount: likeCount,
      channelThumbnailUrl: channelThumbnailUrl,
      tags: tags
    }
  }
}

function extractSessionToken (body) {
  var m = /XSRF_TOKEN':\s*"(.+?)",/i.exec(body)
  return m ? m[1] : undefined
}

function extractCommentToken (body) {
  var m = /COMMENTS_TOKEN':\s*"(.+?)",/i.exec(body)
  return m ? m[1] : undefined
}

function extractCommentCount (body) {
  var response = JSON.parse(body)
  if (!response || !response.body || !response.body['watch-discussion']) {
    return 0
  }

  var $ = cheerio.load(response.body['watch-discussion'])
  var m = /comments?\s*.\s*([\d,]+)/i.exec(
    $('.comment-section-header-renderer').text()
  )
  if (!m || !m[1]) {
    return 0
  }

  return parseInt(m[1].replace(/[\s,]/g, ''), 10)
}

function extractValue ($, attribute) {
  if ($ && $.length) {
    return $.attr(attribute) || undefined
  }
  return undefined
}

function parseDuration (raw) {
  var m = /^[a-z]*(?:(\d+)M)?(\d+)S$/i.exec(raw)
  if (!m) return

  var minutes = m[1] ? parseInt(m[1], 10) : 0
  var seconds = m[2] ? parseInt(m[2], 10) : 0
  return minutes * 60 + seconds
}

function parseVotes (raw) {
  var rawCleaned = raw.replace(/([\D])/gim, '')
  return parseInt(rawCleaned, 10)
}

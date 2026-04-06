export const MAX_BETAIL_COMMENT_LENGTH = 3140

export const sanitizeBetailComment = (value) => String(value ?? '').slice(0, MAX_BETAIL_COMMENT_LENGTH)

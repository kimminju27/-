import { genericParse } from './_generic.mjs'
export async function parse(url) {
  return genericParse(url, {
    listSelector: '.campaign-item, .list-item, article, .board-list li, .review-item',
    titleSelector: '[class*="title"], h3, h4, .subject, .tit',
    linkSelector: 'a',
    typeSelector: '[class*="type"], .media, .channel',
    applicantsSelector: '[class*="apply"], [class*="cnt"], .count',
    capacitySelector: '[class*="limit"], [class*="total"], .max',
    deadlineSelector: '[class*="day"], [class*="date"], .dday',
  })
}

import { describe, expect, it } from 'vitest'
import { recoverPosition } from '../../src/main/desktop/placement'
import { petDimensions, resizePetAroundFeet, alphaHit } from '../../src/shared/pet-geometry'
describe('desktop character geometry', () => {
  it('recovers to the screen containing the visible part', () => {
    const screens=[{id:'primary',x:0,y:0,width:1920,height:1080,scaleFactor:1.25},{id:'right',x:1920,y:0,width:1920,height:1080,scaleFactor:1.5}]
    expect(recoverPosition({x:3700,y:20,width:500,height:600},screens)).toEqual({x:3340,y:20,width:500,height:600})
  })
  it('contains the whole character at 140 percent', () => {
    const layout=petDimensions(1.4,false)
    expect(layout.columnWidth).toBe(491)
    expect(layout.height).toBe(676)
    expect(layout.characterWidth).toBeCloseTo(456.4)
    expect(layout.characterHeight).toBe(616)
    expect(layout.width).toBe(layout.columnWidth)
    expect(petDimensions(1.4,true).width).toBe(791)
  })
  it('keeps the foot anchor when resizing and opening a left chat', () => {
    expect(resizePetAroundFeet({x:0,y:0,width:360,height:500},360,491,676,0,300)).toEqual({x:-365.5,y:-176})
  })
  it('passes transparent pixels through and handles bounds', () => {
    const rgba=new Uint8Array([0,0,0,0,255,255,0,255])
    expect(alphaHit(rgba,2,1,0,0)).toBe(false)
    expect(alphaHit(rgba,2,1,1,0)).toBe(true)
    expect(alphaHit(rgba,2,1,2,0)).toBe(false)
    expect(alphaHit(rgba,2,1,-1,0)).toBe(false)
  })
})

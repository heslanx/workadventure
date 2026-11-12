// Koncluí: every brick color remapped to the platform palette (same letters, same layouts).
Breakout.Colors = {

  arkanoid: {
    w: "#E4ECF5", // white
    o: "#F2814B", // orange
    l: "#4CC3F0", // light blue
    g: "#35D39B", // green
    r: "#E8594E", // red
    b: "#4C7DF0", // blue
    p: "#E873B4", // pink
    y: "#F2C14B", // yellow
    s: "#8C9AAE", // silver
    d: "#D4953A"  // gold
  },

  pastel: {
    y: "#E9D77A", // yellow
    p: "#E38AC4", // pink
    b: "#7F95F2", // blue
    g: "#53E3B2", // green
    o: "#F0A77A"  // orange
  },

  vintage: {
    a: "#E9D77A", // yellow
    b: "#6FB7E0", // light blue
    c: "#1F5C85", // dark blue
    d: "#7FD08A", // light green
    e: "#2F7A3E", // grass
    f: "#E0846A", // red
    g: "#8A8FE8", // purple
    h: "#1F7A5A", // dark green
    i: "#53FFC8", // mint
    j: "#8A6A3A", // brown
    k: "#EBCB9F", // peach
    l: "#4CC3F0"  // blue
  },

  liquidplanner: {
    a: '#4CC3F0', // light blue
    b: '#2E8DE0', // dark  blue
    x: '#98A3B3', // light gray
    y: '#6C7A8E'  // dark  gray
  },


};

Breakout.Levels = [

  { colors: Breakout.Colors.pastel,
    bricks: [
      "", "", "", "", "", "",
      "yyyyyYYYYYyyyyyYYYYYyyyyyYYYYY",
      "pppppPPPPPpppppPPPPPpppppPPPPP",
      "bbbbbBBBBBbbbbbBBBBBbbbbbBBBBB",
      "gggggGGGGGgggggGGGGGgggggGGGGG",
      "oooooOOOOOoooooOOOOOoooooOOOOO"
    ]
  },

  { colors: Breakout.Colors.arkanoid,
    bricks: [
      "", "",
      "          yy      yy          ",
      "            yy  yy            ",
      "            yy  yy            ", 
      "          ssSSssSSss          ",
      "          ssSSssSSss          ",
      "        SSsswwsswwssSS        ",
      "        SSsswwsswwssSS        ",
      "      ssSSssSSssSSssSSss      ",
      "      ssSSssSSssSSssSSss      ",
      "      ss  ssSSssSSss  ss      ",
      "      ss  ss      ss  ss      ",
      "      ss  ss      ss  ss      ",
      "            ss  ss            ",
      "            ss  ss            ",
    ]
  },

  { colors: Breakout.Colors.arkanoid,
    bricks: [
      "",
      "oo",
      "ooll",
      "oollgg",
      "oollggbb",
      "oollggbbrr",
      "oollggbbrroo",
      "oollggbbrrooll",
      "oollggbbrroollgg",
      "oollggbbrroollggbb",
      "oollggbbrroollggbbrr",
      "oollggbbrroollggbbrroo",
      "oollggbbrroollggbbrrooll",
      "oollggbbrroollggbbrroollgg",
      "oollggbbrroollggbbrroollggbb",
      "ssSSssSSssSSssSSssSSssSSssSSrr"
    ]
  },

  { colors: Breakout.Colors.arkanoid,
    bricks: [
      "", "",
      "              ss              ",
      "          bbBBssggGG          ",
      "        BBbbWWwwWWGGgg        ",
      "      bbBBwwWWwwWWwwggGG      ",
      "      bbBBwwWWwwWWwwggGG      ",
      "      bbBBwwWWwwWWwwggGG      ",
      "      ss  ss  ss  ss  ss      ",
      "              ss              ",
      "              ss              ",
      "          oo  oo              ",
      "          ooOOoo              ",
      "            OO                "
    ]
  },

  { colors: Breakout.Colors.pastel,
    bricks: [
      "", "",
      "  yyYYyyYYyyYY  YYyyYYyyYYyy  ",
      "  bbBBbbBBbbBB  BBbbBBbbBBbb  ",
      "  ggGGggGGggGG  GGggGGggGGgg  ",
      "  ooOOooOOooOO  OOooOOooOOoo  ",
      "", "",
      "  yyYYyyYYyyYY  YYyyYYyyYYyy  ",
      "  bbBBbbBBbbBB  BBbbBBbbBBbb  ",
      "  ggGGggGGggGG  GGggGGggGGgg  ",
      "  ooOOooOOooOO  OOooOOooOOoo  ",
      "", "",
      "  yyYYyyYYyyYY  YYyyYYyyYYyy  ",
      "  bbBBbbBBbbBB  BBbbBBbbBBbb  ",
      "  ggGGggGGggGG  GGggGGggGGgg  ",
      "  ooOOooOOooOO  OOooOOooOOoo  "
    ]
  },

  { colors: Breakout.Colors.vintage,
    bricks: [
      "", "", "",
      "   AAaaAAaaAAaaAAaaAAaaAAaa   ",
      "    BBbbBBbbBBbbBBbbBBbbBB    ",
      "     CCccCCccCCccCCccCCcc     ",
      "      DDddDDddDDddDDddDD      ",
      "       EEeeEEeeEEeeEEee       ",
      "        FFffFFffFFffFF        ",
      "         GGggGGggGGgg         ",
      "          HHhhHHhhHH          ",
      "           IIiiIIii           ",
      "            JJjjJJ            ",
      "             KKkk             ",
      "              LL              "
    ]
  },

  { colors: Breakout.Colors.vintage,
    bricks: [
      "", "",
      "  aabbccddeeffggFFEEDDCCBBAA  ",
      "   aabbccddeeffFFEEDDCCBBAA   ",
      "    aabbccddeeffEEDDCCBBAA    ",
      "     aabbccddeeEEDDCCBBAA     ",
      "      aabbccddeeDDCCBBAA      ",
      "       aabbccddDDCCBBAA       ",
      "        aabbccddCCBBAA        ",
      "         aabbccCCBBAA         ",
      "          aabbccBBAA          ",
      "      hh   aabbCCAA   hh      ",
      "     hhHH   aabbAA   hhHH     ",
      "    hhiiHH   aaAA   hhiiHH    ",
      "   hhiiIIHH   aa   hhiiIIHH   ",
      "  hhiijjIIHH      hhiijjIIHH  ",
      " hhiijjJJIIHH    hhiijjJJIIHH "
    ]
  },

  { colors: Breakout.Colors.pastel,
    bricks: [
      "                              ",
      "                              ",
      "  bbBBbbBBbbBBbbBBbbBBbbBBbb  ",
      "  ooggGGggGGggGGggGGggGGggoo  ",
      "  ooggGGggGGggGGggGGggGGggoo  ",
      "  ooppPPppPPppPPppPPppPPppoo  ",
      "  ooppPPppPPppBBppPPppPPppoo  ",
      "  ooppPPppPPbbBBbbPPppPPppoo  ",
      "  ooppPPppBBbbOObbBBppPPppoo  ",
      "  ooppPPbbBBooOOooBBbbPPppoo  ",
      "  ooppBBbbOOooYYooOObbBBppoo  ",
      "  oobbBBOOooyyYYyyooOOBBbboo  ",
      "  oobbooOOYYyyYYyyYYOOoobboo  ",
      "  ooOOooyyYYyyYYyyYYyyooOOoo  ",
      "  ooOOYYyyYYyyYYyyYYyyYYOOoo  ",
      "  ooyyYYyyYYyyYYyyYYyyYYyyoo  ",
      "  ooyyYYyyYYyyYYyyYYyyYYyyoo  ",
      "  bbBBbbBBbbBBbbBBbbBBbbBBbb  "
    ]
  },

  { colors: {
      b: '#3E4858', // black,
      w: '#E4ECF5', // white,
      c: '#F2705F', // cherry,
      s: '#B84439'  // shadow,
    },

    bricks: [
      "",
      "       bBb                    ",
      "      BcCcB                   ",
      "     bCwCcsb  b               ",
      "     bCcCcsb b                ",
      "      BcCsB B                 ",
      "    BbBsSsBbB       bBb       ",
      "   bcCcbBbcCcb     BcCcB      ",
      "  bcwcCsbcwcCsb   bCwCcsb  b  ",
      "  bcCcCsbcCcCsb   bCcCcsb b   ",
      "  bcCcsSbcCcsSb    BcCsB B    ",
      "   bsSsb bsSsb   BbBsSsBbB    ",
      "    bBb   bBb   bcCcbBbcCcb   ",
      "               bcwcCsbcwcCsb  ",
      "               bcCcCsbcCcCsb  ",
      "               bcCcsSbcCcsSb  ",
      "                bsSsb bsSsb   ",
      "                 bBb   bBb    ",
      "                              ",
      "                              ",
      "                              ",
      "                              ",
    ]
  },

  { colors: {
      r: '#E8594E', // red
      b: '#8A6A3A', // brown
      o: '#F2A93B', // orange
      f: '#F2814B', // fire
      w: '#F0F5FB', // white
      e: '#F2D9A8'  // beige
    },

    bricks: [
      "",
      "    rRrRr                     ",
      "   RrRrRrRrR                  ",
      "   BbBoObo                    ",
      "  boboOoboOo       F    f   f ",
      "  bobBoOoboOo     f e         ",
      "  bBoOoObBbB       F  f     e ",
      "    oOoOoOo        Ff      E  ",
      "   bBrbBb        E  f fF F  f ",
      "  bBbrbBrbBb       FfFfFf  F  ",
      " bBbBrRrRbBbB     fFeFeFfFf   ",
      " oObrorRorboO    FfEeEeEfF    ",
      " oOorRrRrRoOo    FeEeWwEeFf   ",
      " oOrRrRrRrRoO   fFeFwWfEeFf   ",
      "   rRr  RrR     fFeFwWfEeFf   ",
      "  bBb    bBb    fFeEwWeEeFf   ",
      " bBbB    bBbB   fFfEeEeEfF    ",
      "                 FfFfFfFfF    ",
      "                   FfFfF      "
    ]
  }


];



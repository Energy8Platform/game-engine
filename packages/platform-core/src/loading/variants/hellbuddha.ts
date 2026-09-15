import type { PreloaderVariant, PreloaderVariantHandle } from './types';

/** Element ids the lifecycle handle binds to. */
const RECT_ID = 'ge-hb-loader-rect';
const TEXT_ID = 'ge-hb-loader-text';

/** The lockup is drawn for a black backdrop (the leg cut-out is #000), so the screen is always black. */
const BACKGROUND = '#000';

/**
 * Length of the lockup's own intro — the artwork's 8s CSS timeline (heartbeat,
 * letters stamping in, a second beat, then settling to white). The loader bar
 * is held back until it has played, and so is the brand gate.
 */
export const HELLBUDDHA_INTRO_MS = 3500;

/** Left edge (SVG units) of the loader bar — aligned with the "H" of the wordmark. */
const LOADER_BAR_X = 572;

/** Max width (SVG units) of the loader bar fill. Spans "H" → end of the "h". */
const LOADER_BAR_MAX_WIDTH = 748;

/** Top (SVG units) of the loader bar — level with the devil's knees. */
const LOADER_BAR_Y = 630;

/** The artwork's own red — the heartbeat colour of the lockup. */
const RED = '#FF2A1E';

/**
 * Hellbuddha lockup — the meditating devil on the left, the "Hellbuddha"
 * wordmark on the right, embedded verbatim as the animated SVG the brand
 * shipped (`hellbuddha-animated.svg`). Its keyframes live in the variant CSS
 * below, scoped under `.ge-hb` so nothing leaks into the host page; the
 * C2PA manifest and the fixed width/height are dropped. The viewBox is cropped
 * to the artwork so the lockup fills the box instead of floating in the
 * export's 1584×1056 canvas.
 *
 * The loader bar sits OUTSIDE `.ge-hb`: that group's universal rule pins every
 * descendant to the 8s one-shot timeline, which would kill the bar's shimmer.
 * The status text is not in the SVG at all — it is pinned to the bottom of the
 * screen (see `buildContentHTML`).
 */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="160 300 1260 400" class="ge-hb-logo-svg" style="overflow:visible" role="img" aria-label="Hellbuddha">
  <defs>
  <path id="hbBody" transform="scale(1.03125 1.03125)" d="M397.209 354.116C407.206 344.711 415.9 318.635 405.048 308.089C400.324 319.307 396.684 325.81 386.144 333.098C371.196 318.765 344.45 317.303 329.748 332.578C329.227 333.121 328.712 333.671 328.205 334.229C316.2 326.175 312.51 322.213 306.504 309.055C302.247 318.679 302.451 327.823 306.327 337.624C308.785 343.94 312.615 349.632 317.54 354.287C317.238 359.491 317.688 364.835 318.13 370.088C318.212 371.056 318.293 372.02 318.369 372.98C312.392 368.731 306.412 364.972 301.802 359.247C302.239 370.334 304.771 398.397 318.983 399.264C319.958 398.525 320.763 397.861 321.847 397.279C329.805 410.635 324.296 411.985 339.165 427.051C323.28 430.464 278.278 443.854 269.459 457.202C266.418 461.804 264.307 467.224 262.729 472.486C258.554 486.408 245.527 548.716 248.427 560.448C249.783 565.936 254.898 570.003 259.358 573.025C241.592 572.845 223.581 573.127 209.924 586.229C197.302 598.337 198.17 616.096 210.805 627.735C233.037 648.214 274.744 652.584 303.377 652.041C312.216 651.865 321.044 651.305 329.835 650.361C331.609 650.177 333.463 649.936 335.359 649.689C340.964 648.96 346.936 648.182 352.313 648.708C359.868 649.448 368.136 652.483 376.579 655.581C394.063 662 412.293 668.691 426.465 655.827C432.002 650.801 429.776 641.391 423.883 637.374C415.183 631.443 403.357 632.253 393.384 630.001C373.031 625.702 351.768 616.921 332.392 609.413C314.832 602.707 297.234 596.1 279.6 589.591C275.278 588.252 248.102 581.549 246.589 579.331C257.299 574.978 279.546 582.901 298.944 589.809C309.761 593.661 319.691 597.198 326.243 598.115C340.733 600.144 357.175 599.806 371.92 600.489C385.725 601.13 402.187 595.274 418.733 589.389C438.167 582.477 457.715 575.524 473.203 579.011L473.277 579.887C463.512 585.885 437.809 588.689 425.773 594.695C417.322 598.912 401.438 602.044 392.502 606.415C386.805 609.201 372.79 612.141 368.365 615.317C370.856 625.313 432.168 623.991 435.2 641.461C435.839 645.139 435.834 648.608 435.829 652.168L435.828 652.656C457.959 649.706 497.346 642.859 509.451 623.537C532.006 587.536 488.18 569.282 459.244 573.703C458.877 573.76 458.511 573.822 458.145 573.892C468.003 567.04 472.534 561.288 469.587 548.646C463.632 523.105 459.992 496.955 453.955 471.54C446.323 439.407 404.457 437.965 379.912 425.054C387.448 414.285 388.151 410.425 392.796 398.283C407.3 404.831 411.755 373.315 413.387 361.767C413.53 360.756 413.651 359.898 413.756 359.232C407.361 365.493 403.916 367.853 395.982 372.508C396.459 366.61 397.154 359.975 397.209 354.116ZM350.787 564.536C345.152 562.781 324.909 567.254 318.726 568.677C306.386 563.586 300.639 557.801 290.93 549.072C288.897 547.244 286.489 546.053 285.103 543.811L288.837 544.818C292.597 540.481 294.864 518.257 295.276 511.905C298.719 524.428 300.288 539.23 304.62 551.492C307.65 560.072 310.806 562.617 318.597 566.169C339.052 562.587 356.201 560.566 377.152 562.301C380.525 562.58 383.769 563.359 387.041 564.144C391.464 565.205 395.937 566.278 400.85 566.148C413.402 558.772 417.798 527.405 420.307 513.125C421.389 524.35 424.688 536.996 427.349 548.032C422.531 554.206 409.248 565.719 402.071 569.539C399.22 569.119 395.531 568.253 391.7 567.353C385.501 565.897 378.929 564.354 374.925 564.472C370.237 564.611 367.393 565.178 365.052 565.645C361.059 566.442 358.527 566.947 350.787 564.536ZM378.155 579.281L363.593 582.571C356.196 582.861 349.667 580.749 342.95 577.918C348.909 577.561 351.803 577.691 356.822 574.588C356.921 574.783 375.826 578.897 378.155 579.281Z"/>
  <path id="hbTail" transform="scale(1.03125 1.03125)" d="M226.99 486.954L226.438 486.184C211.607 490.458 183.088 499.155 170.968 507.903L188.274 511.733C171.179 529.426 164.234 552.428 178.926 574.23C184.633 582.7 189.949 585.971 198.354 591.228C201.895 585.056 203.88 583.751 208.604 578.669C198.396 572.816 187.183 566.381 183.958 554.175C180.033 539.318 187.694 528.367 197.693 518.708C201.475 524.774 203.488 529.056 206.532 535.56C209.72 526.074 210.906 519.618 215.131 510.154C218.702 502.157 223.649 494.507 226.99 486.954Z"/>
  <path id="hbLeg" transform="scale(1.03125 1.03125)" d="M303.975 542.416C299.777 527.392 298.026 510.34 293.162 495.571C293.184 496.547 293.207 497.491 293.23 498.412C293.413 505.911 293.558 511.807 292.723 519.763C292.478 522.097 291.749 526.067 290.987 530.216C289.903 536.125 288.751 542.396 288.837 544.818C292.597 540.481 294.864 518.257 295.276 511.905C298.719 524.428 300.288 539.23 304.62 551.492C307.65 560.072 310.806 562.617 318.597 566.169C339.052 562.587 356.201 560.566 377.152 562.301C380.525 562.58 383.769 563.359 387.041 564.144C391.464 565.205 395.937 566.278 400.85 566.148C413.402 558.772 417.798 527.405 420.307 513.125C421.389 524.35 424.688 536.996 427.349 548.032C422.531 554.206 409.248 565.719 402.071 569.539C399.22 569.119 395.531 568.253 391.7 567.353C385.501 565.897 378.929 564.354 374.925 564.472C370.237 564.611 367.393 565.178 365.052 565.645C361.059 566.442 358.527 566.947 350.787 564.536C345.152 562.781 324.909 567.254 318.726 568.677C306.386 563.586 300.639 557.801 290.93 549.072C288.897 547.244 286.489 546.053 285.103 543.811C283.839 541.996 281.163 540.649 278.984 541.178L278.964 542.36C291.92 551.956 302.972 563.144 316.614 570.003C318.056 569.791 320.061 569.407 322.416 568.956C333.924 566.753 353.799 562.947 357.348 569.789C356.384 576.513 343.506 576.937 337.371 578.082C340.571 579.03 343.355 579.943 345.86 580.765C359.155 585.128 364.578 586.908 382.442 577.482C376.414 577.06 361.435 576.5 358.114 570.661C362.174 561.735 389.148 568.266 399.612 570.799C400.327 570.972 400.966 571.126 401.514 571.256C411.628 566.839 428.385 550.149 439.226 541.93L438.885 540.864C435.439 541.321 431.602 543.961 429.078 546.298L428.893 545.624C423.505 525.957 421.252 517.732 422.938 497.145C418.29 509.407 416.774 524.848 413.233 537.64C410.669 546.902 409.415 559.956 399.578 564.525C395.014 564.813 390.651 563.606 386.436 562.44C383.324 561.579 380.292 560.741 377.319 560.542C363.046 559.587 345.3 559.771 331.199 562.596C311.411 566.56 308.903 560.052 303.975 542.416ZM363.593 582.571C356.196 582.861 349.667 580.749 342.95 577.918C348.909 577.561 351.803 577.691 356.822 574.588C356.921 574.783 375.826 578.897 378.155 579.281L363.593 582.571Z"/>
  <path id="hbL0" transform="scale(1.03125 1.03125)" d="M661.905 371.838L660.347 371.982C648.81 375.63 634.412 378.486 624.016 382.024C623.219 399.329 622.846 416.651 622.897 433.974C622.899 434.788 622.899 435.653 622.899 436.56C622.9 443.868 622.901 453.797 623.843 459.993C622.344 460.17 620.017 460.487 617.307 460.856C609.404 461.933 598.239 463.454 594.822 463.255C591.587 459.817 595.625 389.503 596.569 381.032C582.482 384.449 566.088 388.032 552.341 392.051C552.75 417.88 554.694 444.142 554.913 469.466C549.28 470.206 530.763 472.651 526.806 475.39C527.327 479.224 534.762 482.307 538.185 484.267L535.952 485.225C535.224 489.566 542.764 496.564 546.955 497.218C547.844 497.357 548.635 497.396 549.377 497.434C551.104 497.52 552.568 497.594 554.391 498.868C555.271 502.178 555.399 511.342 555.567 515.152L557.394 556.441C557.667 562.726 557.534 573.664 559.066 579.21L559.367 579.303C560.718 578.416 563.07 577.116 565.846 575.581C574.376 570.866 586.91 563.937 586.718 559.98C587.864 560.333 588.363 560.579 589.452 561.092L596.534 559.245C596.452 557.073 596.194 552.667 595.869 547.102C594.782 528.527 592.94 497.05 594.37 492.727C602.546 490.104 615.691 489.918 624.489 487.543C624.478 498.406 627.748 569 630.323 575.808C634.729 575.312 643.682 570.332 647.781 567.634C648.357 567.256 648.946 565.166 649.155 564.398L649.586 564.373C655.209 564.019 655.745 563.373 660.297 560.395C658.13 536.65 658.064 512.328 659.209 488.551C659.444 483.665 659.272 480.986 658.44 476.197C668.944 471.749 676.256 462.805 681.593 452.919C674.214 454.26 666.793 455.356 659.342 456.205C659.071 428.756 660.918 400.232 662.95 372.782L661.905 371.838Z"/>
  <path id="hbL1" transform="scale(1.03125 1.03125)" d="M751.885 472.716C749.149 457.244 739.74 452.167 724.967 451.936C712.936 452.375 689.089 457.396 681.752 466.63C668.963 482.726 668.753 535.003 683.368 549.769C693.29 559.794 721.265 550.172 737.785 544.49C741.104 543.348 743.961 542.365 746.116 541.733C748.018 540.722 749.45 540.462 749.911 538.232C750.625 534.772 750.464 531.124 750.303 527.487C750.2 525.172 750.098 522.863 750.222 520.61C741.956 523.939 733.46 527.839 724.756 529.667C711.461 532.46 706.689 530.242 703.478 517.19C731.229 513.785 758.004 507.311 751.885 472.716ZM721.707 488.586C719.227 494.626 716.21 495.971 710.496 498.171C710.19 498.269 709.905 498.363 709.635 498.452C707.503 499.151 706.327 499.537 703.727 499.47C700.523 494.937 704.679 483.239 707.148 478.893C709.566 474.635 711.466 473.227 715.997 471.941C717.413 471.982 718.255 472.26 719.605 472.604C724.822 476.876 724.026 482.935 721.707 488.586Z"/>
  <path id="hbL2" transform="scale(1.03125 1.03125)" d="M792.108 412.564C792.539 408.858 793.08 404.199 792.593 401.453C786.287 402.912 762.73 407.382 759.804 410.944C759.243 413.493 759.926 415.497 760.732 417.859C760.93 418.438 761.134 419.038 761.33 419.673C760.7 420.43 759.945 421.337 759.065 422.395C757.48 450.126 759.055 500.361 761.4 525.972C762.265 534.948 763.25 543.911 764.356 552.859C764.8 554.149 764.913 555.474 765.937 555.682C770.086 556.525 778.083 553.849 784.326 551.761C786.534 551.022 788.523 550.357 790.044 549.947C785.754 505.726 787.672 459.566 791.791 415.46C791.869 414.619 791.984 413.631 792.108 412.564Z"/>
  <path id="hbL3" transform="scale(1.03125 1.03125)" d="M839.761 397.624L838.57 396.918C828.141 399.541 817.221 402.101 807 405.333C804.56 425.31 804.642 447.941 804.721 469.437C804.748 476.823 804.774 484.074 804.698 491.038C804.623 497.941 807.214 554.55 808.808 557.057C817.967 555.068 829.067 551.381 838.193 548.599C835.014 519.128 835.071 484.074 836.257 454.688C836.664 443.938 837.254 433.197 838.027 422.468C838.182 420.407 838.546 417.921 838.934 415.271C839.822 409.206 840.835 402.28 839.761 397.624Z"/>
  <path id="hbL4" transform="scale(1.03125 1.03125)" d="M882.38 402.403L882.167 402.228C872.09 404.538 861.003 406.244 850.752 408.015C850.527 417.097 850.184 425.814 849.845 434.416C849.132 452.543 848.438 470.162 848.909 489.625C849.116 498.187 849.748 507.802 850.381 517.428C851.201 529.913 852.023 542.416 851.921 552.663C867.003 551.918 888.424 547.782 902.823 543.017C913.002 539.236 921.18 537.689 925.701 526.831C931.868 512.025 932.063 497.099 931.496 481.422C930.413 451.434 908.683 447.844 884.527 457.75C882.681 458.517 880.881 459.39 879.135 460.363C879.207 445.066 880.249 430.364 881.82 415.164C881.873 414.653 881.96 413.964 882.061 413.168C882.51 409.618 883.228 403.937 882.38 402.403ZM878.906 510.091C878.662 499.957 878.422 489.968 878.495 478.961C883.152 477.236 887.869 475.677 892.637 474.288L894.854 474.564C903.152 479.687 900.996 499.782 899.079 507.817C897.111 516.067 892.659 521.147 885.46 525.331C883.509 526.615 881.324 527.796 879.284 528.957C879.203 522.442 879.054 516.24 878.906 510.091Z"/>
  <path id="hbL5" transform="scale(1.03125 1.03125)" d="M1022.62 454.171C1022.1 454.048 1021.64 453.94 1021.18 454.069C1010.77 455.587 999.486 457.385 989.084 458.535C988.68 470.67 987.933 502.015 989.935 513.189C989.404 513.445 988.734 513.778 987.962 514.162C983.063 516.598 974.079 521.064 970.791 520.572C965.965 513.673 969.151 465.597 970.852 455.738L970.958 455.154C960.009 456.647 949.045 458.028 938.067 459.295C938.065 470.461 938.302 481.052 938.539 491.669C938.699 498.811 938.859 505.965 938.947 513.313L939.062 513.951C939.557 516.826 939.845 520.04 940.139 523.331C941.422 537.702 942.837 553.544 962.305 549.023C973.223 546.487 984.568 539.785 991.552 531.041C992.785 540.502 993.052 543.571 1000.2 549.638C1003.77 549.174 1009.93 548.623 1013.07 547.354C1013.81 545.84 1013.79 545.676 1013.64 544.574C1013.59 544.212 1013.53 543.75 1013.48 543.105C1017.85 545.656 1018.86 546.868 1020.15 547.434C1021.5 548.02 1023.14 547.915 1029.12 547.888C1022.17 530.677 1022.29 514.357 1022.42 496.922C1022.46 491.766 1022.49 486.512 1022.35 481.109C1022.3 479.036 1022.62 475.619 1022.98 471.874C1023.64 465.046 1024.39 457.128 1023.14 454.287C1022.96 454.252 1022.78 454.211 1022.62 454.171Z"/>
  <path id="hbL6" transform="scale(1.03125 1.03125)" d="M1120.34 403.384C1119.92 403.352 1119.5 403.514 1118.13 403.705C1108.71 406.069 1100.49 408.512 1091.23 411.306C1091.12 413.414 1090.8 416.285 1090.46 419.27C1089.91 424.137 1089.33 429.306 1089.58 431.958C1090.76 432.545 1090.84 432.5 1091.04 432.395C1091.2 432.307 1091.45 432.178 1092.48 432.344C1092.04 434.339 1089.14 436.145 1088.96 437.642C1088.31 443.223 1088.37 450.851 1088.13 456.431C1070.16 452.617 1035.74 455.636 1033.22 478.607C1031.03 498.563 1030.35 523.013 1038.81 541.859C1039.92 544.25 1045.56 547.861 1047.8 549.161C1054.59 549.268 1056.87 549.18 1063.66 548.168C1074.45 543.658 1079.35 541.384 1087.29 532.371C1089.28 552.816 1090.07 552.698 1101.27 551.036C1103.94 550.64 1107.2 550.157 1111.2 549.843C1112.23 548.556 1112.23 548.491 1112.07 547.268C1112.02 546.87 1111.95 546.35 1111.9 545.625C1113.23 546.032 1114.47 546.599 1115.66 547.141C1118.41 548.399 1120.88 549.527 1123.54 548.233C1123.59 547.192 1122.57 545.323 1121.41 543.194C1120.16 540.906 1118.75 538.319 1118.33 536.139C1111.6 501.277 1115.31 465.845 1118.98 430.862L1119.26 428.195C1119.45 426.381 1119.95 423.8 1120.5 420.966C1121.7 414.73 1123.15 407.267 1122.03 404.035C1121.05 403.591 1120.7 403.412 1120.34 403.384ZM1073.42 519.982C1070.82 520.879 1067.56 521.76 1064.87 522.562L1064.76 522.192L1064.58 521.573C1060.53 508.015 1059.47 480.876 1074.79 473.543C1085.55 472.938 1085.43 477.852 1085.24 485.03C1085.21 486.515 1085.17 488.098 1085.22 489.748C1085.47 497.696 1085.54 505.572 1085.96 513.526C1081.66 515.94 1077.83 517.843 1073.42 519.982Z"/>
  <path id="hbL7" transform="scale(1.03125 1.03125)" d="M1205.5 403.684C1205.07 403.514 1205 403.484 1204.27 403.646C1198.46 405.222 1193.12 406.736 1187.14 407.494C1182.23 408.118 1177.61 408.085 1172.82 409.045C1172.85 417.579 1172.58 425.903 1172.31 434.185C1172.06 441.705 1171.82 449.189 1171.8 456.763C1153.06 452 1129.18 458.82 1125.35 480.091C1122.37 496.671 1122.68 515.844 1127.14 532.109C1131 546.203 1137.16 549.949 1150.87 547.524C1161.35 543.621 1164.89 541.012 1172.67 533.199C1172.85 534.34 1173.01 535.497 1173.16 536.646C1174.3 545.118 1175.38 553.116 1186.73 550.573C1189.08 550.049 1189.5 549.901 1190.84 548.091L1190.71 545.07C1191.39 545.389 1192.05 545.72 1192.7 546.047C1196.11 547.752 1199.26 549.329 1202.93 548.285C1203.17 548.031 1203.39 547.849 1203.57 547.695C1204.05 547.293 1204.3 547.078 1204.27 546.256C1204.02 538.627 1201.89 530.884 1201.53 523.253C1199.98 490.372 1200.9 457.632 1204.15 424.87C1204.33 423.056 1204.67 420.815 1205.02 418.428C1205.78 413.369 1206.64 407.655 1206.31 403.973C1205.93 403.854 1205.68 403.756 1205.5 403.684ZM1172.03 514.811C1168.1 516.507 1164.57 517.703 1160.54 519.076C1158.3 519.118 1156.95 518.98 1154.72 518.752L1154.67 518.747C1149.14 513.415 1151.93 485.647 1156.8 479.532C1160.39 475.024 1160.73 474.72 1165.95 473.529C1166.88 473.595 1169.93 474.318 1170.07 474.925C1171.92 482.727 1171.84 507.566 1172.03 514.811Z"/>
  <path id="hbL8" transform="scale(1.03125 1.03125)" d="M1240.52 450.538L1239.45 450.196C1229.89 452.322 1220.33 454.368 1210.74 456.335C1210.55 469.417 1209.88 541.047 1214.73 548.012C1218.65 549.816 1224.73 548.858 1230.61 547.932C1233.97 547.404 1237.27 546.885 1240.05 546.898C1239.88 544.431 1239.68 541.754 1239.47 538.946C1238.55 526.388 1237.43 511.196 1237.54 500.341C1240.4 498.124 1248.99 490.678 1251.36 489.622C1252.68 491.068 1252.76 498.728 1252.82 504.693C1252.85 507.186 1252.87 509.383 1252.98 510.706C1253.41 523.314 1253.36 536.654 1254.01 549.098C1261.42 549.206 1268.82 549.581 1276.21 550.222C1276.07 524.355 1276 498.75 1277.84 472.943C1278.09 469.491 1278.25 466.022 1278.14 462.561C1255 456.489 1254.14 458.205 1250.17 466.148C1248.14 470.209 1245.3 475.897 1238.25 483.005C1238.31 482.316 1238.44 481.087 1238.6 479.498C1239.45 470.963 1241.35 452.033 1240.52 450.538Z"/>
  <path id="hbL9" transform="scale(1.03125 1.03125)" d="M1346.85 491.42C1344.36 471.465 1341.66 449.813 1315.32 453.346C1309.29 454.163 1290.73 458.642 1285.68 461.77C1284.36 464.42 1286.12 472.276 1287.24 477.261C1287.48 478.32 1287.69 479.25 1287.83 479.972C1289.06 479.684 1290.83 479.107 1292.91 478.43C1302.96 475.16 1320.21 469.544 1318.9 482.713C1315.63 484.82 1312.61 484.965 1309.18 486.711C1297.64 492.437 1286.65 500.743 1283.95 514.084C1282.23 522.581 1282.98 533.885 1287.05 541.627C1290.71 548.591 1299.13 549.477 1305.95 549.214C1316.07 546.724 1323.86 543.607 1329.5 534.415C1329.69 535.12 1329.87 535.823 1330.05 536.518C1332.34 545.443 1334.33 553.182 1346.24 549.757C1347.62 548.601 1347.6 548.726 1348.25 547.064C1350.02 547.277 1351.44 547.483 1352.72 547.668C1356.03 548.147 1358.33 548.482 1363.15 548.414C1351.19 532.895 1350.47 517.183 1347.77 498.432C1347.44 496.149 1347.15 493.796 1346.85 491.42ZM1324.48 517.885C1319.85 521.121 1315.89 523.327 1310.61 525.281C1302.14 515.656 1314.24 506.155 1321.99 501.851C1322.42 502.539 1324.07 515.836 1324.48 517.885Z"/>
  </defs>
  <g class="ge-hb">
    <g class="body"><g class="f"><use xlink:href="#hbBody"/><use xlink:href="#hbTail"/></g><use xlink:href="#hbLeg" class="dark"/></g>
    <g class="ltr l0"><use xlink:href="#hbL0" class="f"/></g>
    <g class="ltr l1"><use xlink:href="#hbL1" class="f"/></g>
    <g class="ltr l2"><use xlink:href="#hbL2" class="f"/></g>
    <g class="ltr l3"><use xlink:href="#hbL3" class="f"/></g>
    <g class="ltr l4"><use xlink:href="#hbL4" class="f"/></g>
    <g class="ltr l5"><use xlink:href="#hbL5" class="f"/></g>
    <g class="ltr l6"><use xlink:href="#hbL6" class="f"/></g>
    <g class="ltr l7"><use xlink:href="#hbL7" class="f"/></g>
    <g class="ltr l8"><use xlink:href="#hbL8" class="f"/></g>
    <g class="ltr l9"><use xlink:href="#hbL9" class="f"/></g>
  </g>

  <g class="ge-hb-loader">
    <rect x="${LOADER_BAR_X}" y="${LOADER_BAR_Y}" width="${LOADER_BAR_MAX_WIDTH}" height="8" fill="rgba(255,255,255,0.12)"/>
    <clipPath id="ge-hb-loader-clip">
      <rect id="${RECT_ID}" x="${LOADER_BAR_X}" y="${LOADER_BAR_Y}" width="0" height="8" class="ge-hb-clip-rect"/>
    </clipPath>
    <rect x="${LOADER_BAR_X}" y="${LOADER_BAR_Y}" width="${LOADER_BAR_MAX_WIDTH}" height="8" fill="${RED}" clip-path="url(#ge-hb-loader-clip)"/>
  </g>
</svg>`;

export const hellbuddhaVariant: PreloaderVariant = {
  splash: false,
  introMs: HELLBUDDHA_INTRO_MS,
  background: BACKGROUND,

  buildContentHTML() {
    return `
    <div class="ge-hb-content">
      ${LOGO_SVG}
    </div>
    <div class="ge-hb-status ge-hb-loader">
      <span id="${TEXT_ID}" class="ge-hb-text">Loading...</span>
    </div>
  `;
  },

  css: `
    .ge-hb-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 88%;
      max-width: 780px;
    }

    .ge-hb-logo-svg {
      width: 100%;
      height: auto;
    }

    /* ── The lockup's own intro, verbatim from the export (rescoped .hb → .ge-hb) ── */
    .ge-hb *{animation-duration:8.0s;animation-timing-function:ease-in-out;animation-fill-mode:both;animation-iteration-count:1}
    .ge-hb .body{transform-box:fill-box;transform-origin:50% 60%}
    .ge-hb .ltr{transform-box:fill-box;transform-origin:50% 100%}
    .ge-hb .dark{fill:#000}
    @keyframes hbBodyFill{0%{fill:#FEFEFE}15%{fill:#FEFEFE}17%{fill:#FFD2C2}20%{fill:#FF2A1E}22%{fill:#D9231A}24%{fill:#FF2A1E}27%{fill:#D9231A}68%{fill:#D9231A}70%{fill:#FFD2C2}73%{fill:#FF2A1E}75%{fill:#FFD2C2}77%{fill:#FF2A1E}82%{fill:#FEFEFE}100%{fill:#FEFEFE}}
    @keyframes hbThump{0%{transform:scale(1)}15%{transform:scale(1)}16.5%{transform:scale(1.045)}19%{transform:scale(1)}21%{transform:scale(1.03)}24%{transform:scale(1)}68%{transform:scale(1)}69.5%{transform:scale(1.045)}72%{transform:scale(1)}74%{transform:scale(1.03)}77%{transform:scale(1)}100%{transform:scale(1)}}
    @keyframes hbL0{0%{opacity:0;transform:scale(1.7) rotate(-8deg)}30%{opacity:0;transform:scale(1.7) rotate(-8deg)}33.575%{opacity:1;transform:scale(.9) rotate(1.5deg)}36.5%{opacity:1;transform:scale(1) rotate(0deg)}69.5%{transform:scale(1)}71%{transform:scale(1.035)}74%{transform:scale(1)}100%{opacity:1}}
    @keyframes hbLF0{0%{fill:#FFFFFF}30%{fill:#FFFFFF}32.275%{fill:#FFD2C2}36.5%{fill:#FF2A1E}42.5%{fill:#D9231A}68%{fill:#D9231A}70%{fill:#FFD2C2}73%{fill:#FF2A1E}75%{fill:#FFD2C2}77%{fill:#FF2A1E}82%{fill:#FEFEFE}100%{fill:#FEFEFE}}
    .ge-hb .l0{animation-name:hbL0}
    .ge-hb .l0 .f{animation-name:hbLF0}
    @keyframes hbL1{0%{opacity:0;transform:scale(1.7) rotate(-8deg)}33.2%{opacity:0;transform:scale(1.7) rotate(-8deg)}36.775%{opacity:1;transform:scale(.9) rotate(1.5deg)}39.7%{opacity:1;transform:scale(1) rotate(0deg)}69.5%{transform:scale(1)}71%{transform:scale(1.035)}74%{transform:scale(1)}100%{opacity:1}}
    @keyframes hbLF1{0%{fill:#FFFFFF}33.2%{fill:#FFFFFF}35.475%{fill:#FFD2C2}39.7%{fill:#FF2A1E}45.7%{fill:#D9231A}68%{fill:#D9231A}70%{fill:#FFD2C2}73%{fill:#FF2A1E}75%{fill:#FFD2C2}77%{fill:#FF2A1E}82%{fill:#FEFEFE}100%{fill:#FEFEFE}}
    .ge-hb .l1{animation-name:hbL1}
    .ge-hb .l1 .f{animation-name:hbLF1}
    @keyframes hbL2{0%{opacity:0;transform:scale(1.7) rotate(-8deg)}36.4%{opacity:0;transform:scale(1.7) rotate(-8deg)}39.975%{opacity:1;transform:scale(.9) rotate(1.5deg)}42.9%{opacity:1;transform:scale(1) rotate(0deg)}69.5%{transform:scale(1)}71%{transform:scale(1.035)}74%{transform:scale(1)}100%{opacity:1}}
    @keyframes hbLF2{0%{fill:#FFFFFF}36.4%{fill:#FFFFFF}38.675%{fill:#FFD2C2}42.9%{fill:#FF2A1E}48.9%{fill:#D9231A}68%{fill:#D9231A}70%{fill:#FFD2C2}73%{fill:#FF2A1E}75%{fill:#FFD2C2}77%{fill:#FF2A1E}82%{fill:#FEFEFE}100%{fill:#FEFEFE}}
    .ge-hb .l2{animation-name:hbL2}
    .ge-hb .l2 .f{animation-name:hbLF2}
    @keyframes hbL3{0%{opacity:0;transform:scale(1.7) rotate(-8deg)}39.6%{opacity:0;transform:scale(1.7) rotate(-8deg)}43.175%{opacity:1;transform:scale(.9) rotate(1.5deg)}46.1%{opacity:1;transform:scale(1) rotate(0deg)}69.5%{transform:scale(1)}71%{transform:scale(1.035)}74%{transform:scale(1)}100%{opacity:1}}
    @keyframes hbLF3{0%{fill:#FFFFFF}39.6%{fill:#FFFFFF}41.875%{fill:#FFD2C2}46.1%{fill:#FF2A1E}52.1%{fill:#D9231A}68%{fill:#D9231A}70%{fill:#FFD2C2}73%{fill:#FF2A1E}75%{fill:#FFD2C2}77%{fill:#FF2A1E}82%{fill:#FEFEFE}100%{fill:#FEFEFE}}
    .ge-hb .l3{animation-name:hbL3}
    .ge-hb .l3 .f{animation-name:hbLF3}
    @keyframes hbL4{0%{opacity:0;transform:scale(1.7) rotate(-8deg)}42.8%{opacity:0;transform:scale(1.7) rotate(-8deg)}46.375%{opacity:1;transform:scale(.9) rotate(1.5deg)}49.3%{opacity:1;transform:scale(1) rotate(0deg)}69.5%{transform:scale(1)}71%{transform:scale(1.035)}74%{transform:scale(1)}100%{opacity:1}}
    @keyframes hbLF4{0%{fill:#FFFFFF}42.8%{fill:#FFFFFF}45.075%{fill:#FFD2C2}49.3%{fill:#FF2A1E}55.3%{fill:#D9231A}68%{fill:#D9231A}70%{fill:#FFD2C2}73%{fill:#FF2A1E}75%{fill:#FFD2C2}77%{fill:#FF2A1E}82%{fill:#FEFEFE}100%{fill:#FEFEFE}}
    .ge-hb .l4{animation-name:hbL4}
    .ge-hb .l4 .f{animation-name:hbLF4}
    @keyframes hbL5{0%{opacity:0;transform:scale(1.7) rotate(-8deg)}46%{opacity:0;transform:scale(1.7) rotate(-8deg)}49.575%{opacity:1;transform:scale(.9) rotate(1.5deg)}52.5%{opacity:1;transform:scale(1) rotate(0deg)}69.5%{transform:scale(1)}71%{transform:scale(1.035)}74%{transform:scale(1)}100%{opacity:1}}
    @keyframes hbLF5{0%{fill:#FFFFFF}46%{fill:#FFFFFF}48.275%{fill:#FFD2C2}52.5%{fill:#FF2A1E}58.5%{fill:#D9231A}68%{fill:#D9231A}70%{fill:#FFD2C2}73%{fill:#FF2A1E}75%{fill:#FFD2C2}77%{fill:#FF2A1E}82%{fill:#FEFEFE}100%{fill:#FEFEFE}}
    .ge-hb .l5{animation-name:hbL5}
    .ge-hb .l5 .f{animation-name:hbLF5}
    @keyframes hbL6{0%{opacity:0;transform:scale(1.7) rotate(-8deg)}49.2%{opacity:0;transform:scale(1.7) rotate(-8deg)}52.775%{opacity:1;transform:scale(.9) rotate(1.5deg)}55.7%{opacity:1;transform:scale(1) rotate(0deg)}69.5%{transform:scale(1)}71%{transform:scale(1.035)}74%{transform:scale(1)}100%{opacity:1}}
    @keyframes hbLF6{0%{fill:#FFFFFF}49.2%{fill:#FFFFFF}51.475%{fill:#FFD2C2}55.7%{fill:#FF2A1E}61.7%{fill:#D9231A}68%{fill:#D9231A}70%{fill:#FFD2C2}73%{fill:#FF2A1E}75%{fill:#FFD2C2}77%{fill:#FF2A1E}82%{fill:#FEFEFE}100%{fill:#FEFEFE}}
    .ge-hb .l6{animation-name:hbL6}
    .ge-hb .l6 .f{animation-name:hbLF6}
    @keyframes hbL7{0%{opacity:0;transform:scale(1.7) rotate(-8deg)}52.4%{opacity:0;transform:scale(1.7) rotate(-8deg)}55.975%{opacity:1;transform:scale(.9) rotate(1.5deg)}58.9%{opacity:1;transform:scale(1) rotate(0deg)}69.5%{transform:scale(1)}71%{transform:scale(1.035)}74%{transform:scale(1)}100%{opacity:1}}
    @keyframes hbLF7{0%{fill:#FFFFFF}52.4%{fill:#FFFFFF}54.675%{fill:#FFD2C2}58.9%{fill:#FF2A1E}64.9%{fill:#D9231A}68%{fill:#D9231A}70%{fill:#FFD2C2}73%{fill:#FF2A1E}75%{fill:#FFD2C2}77%{fill:#FF2A1E}82%{fill:#FEFEFE}100%{fill:#FEFEFE}}
    .ge-hb .l7{animation-name:hbL7}
    .ge-hb .l7 .f{animation-name:hbLF7}
    @keyframes hbL8{0%{opacity:0;transform:scale(1.7) rotate(-8deg)}55.6%{opacity:0;transform:scale(1.7) rotate(-8deg)}59.175%{opacity:1;transform:scale(.9) rotate(1.5deg)}62.1%{opacity:1;transform:scale(1) rotate(0deg)}69.5%{transform:scale(1)}71%{transform:scale(1.035)}74%{transform:scale(1)}100%{opacity:1}}
    @keyframes hbLF8{0%{fill:#FFFFFF}55.6%{fill:#FFFFFF}57.875%{fill:#FFD2C2}62.1%{fill:#FF2A1E}68.1%{fill:#D9231A}68%{fill:#D9231A}70%{fill:#FFD2C2}73%{fill:#FF2A1E}75%{fill:#FFD2C2}77%{fill:#FF2A1E}82%{fill:#FEFEFE}100%{fill:#FEFEFE}}
    .ge-hb .l8{animation-name:hbL8}
    .ge-hb .l8 .f{animation-name:hbLF8}
    @keyframes hbL9{0%{opacity:0;transform:scale(1.7) rotate(-8deg)}58.8%{opacity:0;transform:scale(1.7) rotate(-8deg)}62.375%{opacity:1;transform:scale(.9) rotate(1.5deg)}65.3%{opacity:1;transform:scale(1) rotate(0deg)}69.5%{transform:scale(1)}71%{transform:scale(1.035)}74%{transform:scale(1)}100%{opacity:1}}
    @keyframes hbLF9{0%{fill:#FFFFFF}58.8%{fill:#FFFFFF}61.075%{fill:#FFD2C2}65.3%{fill:#FF2A1E}71.3%{fill:#D9231A}68%{fill:#D9231A}70%{fill:#FFD2C2}73%{fill:#FF2A1E}75%{fill:#FFD2C2}77%{fill:#FF2A1E}82%{fill:#FEFEFE}100%{fill:#FEFEFE}}
    .ge-hb .l9{animation-name:hbL9}
    .ge-hb .l9 .f{animation-name:hbLF9}
    .ge-hb .body{animation-name:hbThump}
    .ge-hb .body .f{animation-name:hbBodyFill}

    /* Bar + status text fade in once the intro has played. */
    .ge-hb-loader {
      opacity: 0;
      animation: ge-hb-loader-in 0.5s ease-out ${HELLBUDDHA_INTRO_MS}ms forwards;
    }

    @keyframes ge-hb-loader-in {
      to { opacity: 1; }
    }

    /* Shimmer the loader bar while waiting */
    .ge-hb-clip-rect {
      animation: ge-hb-fill 2s ease-in-out infinite;
    }

    @keyframes ge-hb-fill {
      0%   { width: 0; }
      50%  { width: ${LOADER_BAR_MAX_WIDTH}px; }
      100% { width: 0; }
    }

    /* Stop shimmer once JS-driven progress takes over. */
    .ge-hb-clip-rect.driven {
      animation: none;
    }

    /* Status text — pinned to the bottom of the screen, not to the lockup. */
    .ge-hb-status {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 8%;
      text-align: center;
    }

    .ge-hb-text {
      display: inline-block;
      color: rgba(255, 255, 255, 0.6);
      font-size: 15px;
      font-weight: 600;
      letter-spacing: 3px;
      animation: ge-hb-pulse 1.5s ease-in-out infinite;
    }

    @keyframes ge-hb-pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }

    /* Tap-to-start CTA pulse. Compound selector outweighs the ambient
       .ge-hb-text rule, swapping the animation cleanly. */
    .ge-hb-text.ge-hb-tap-pulse {
      animation: ge-hb-tap 1.2s ease-in-out infinite;
    }

    @keyframes ge-hb-tap {
      0%, 100% { opacity: 0.5; }
      50%      { opacity: 1; }
    }

    /* Last so it outranks the intro + fade-in rules above: still artwork, bar up at once. */
    @media (prefers-reduced-motion: reduce) {
      .ge-hb * { animation: none !important; }
      .ge-hb .f { fill: #FEFEFE; }
      .ge-hb .ltr { opacity: 1; }
      .ge-hb-loader { opacity: 1; animation: none; }
    }
  `,

  mount(overlay): PreloaderVariantHandle | null {
    const rectEl = overlay.querySelector(`#${RECT_ID}`) as SVGRectElement | null;
    const textEl = overlay.querySelector(`#${TEXT_ID}`) as HTMLElement | null;
    if (!rectEl || !textEl) return null;

    let driven = false;

    return {
      setProgress(p, showPercentage) {
        if (!driven) {
          rectEl.classList.add('driven');
          driven = true;
        }
        rectEl.setAttribute('width', String(p * LOADER_BAR_MAX_WIDTH));
        if (showPercentage) {
          textEl.textContent = `${Math.round(p * 100)}%`;
        }
      },
      showTapText(text) {
        textEl.textContent = text;
        textEl.classList.add('ge-hb-tap-pulse');
      },
    };
  },
};

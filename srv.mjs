import WHtml2pngServer from './src/WHtml2pngServer.mjs'


let opt = {
    port: 9020,
    apiName: 'api',
}
WHtml2pngServer(opt)


let test = `
[POST] http://localhost:9020/api

{
    width: 500,
    height: 400,
    scale: 3,
    opt: {
    
        title: {
            text: 'Logarithmic axis demo'
        },
    
        xAxis: {
            tickInterval: 1,
            type: 'logarithmic',
            accessibility: {
                rangeDescription: 'Range: 1 to 10'
            }
        },
    
        yAxis: {
            type: 'logarithmic',
            minorTickInterval: 0.1,
            accessibility: {
                rangeDescription: 'Range: 0.1 to 1000'
            }
        },
    
        tooltip: {
            headerFormat: '<b>{series.name}</b><br />',
            pointFormat: 'x = {point.x}, y = {point.y}'
        },
    
        series: [{
            data: [1, 2, 4, 8, 16, 32, 64, 128, 256, 512],
            pointStart: 1
        }]
    
    }

}
`

//node --experimental-modules srv.mjs
